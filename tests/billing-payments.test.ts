import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { openDb, type Db } from "@/lib/db/core";
import { saveCeiling } from "@/lib/billing/config";
import { claimResource } from "@/lib/billing/attribution";
import { reserveUsage, settleUsage, billingHold } from "@/lib/billing/budget";
import { finalizeStatement, breakdown, isPaid } from "@/lib/billing/statements";
import { createCheckout } from "@/lib/billing/checkout";
import { processWebhook, reconcileFee, reconcilePendingFees } from "@/lib/billing/webhooks";
import { testStripe, verifyWebhook, checkoutUrlAllowed, localTestApi } from "@/lib/billing/provider";
let db: Db, statementId: number, amount: number;
const jan = "2026-01-01T00:00:00.000Z", feb = "2026-02-01T00:00:00.000Z";
function session(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return { id: "cs_test_fixture", object: "checkout.session", livemode: false, mode: "payment", currency: "usd", amount_total: amount, client_reference_id: String(statementId), metadata: { statement_id: String(statementId), user_id: "1", billing_mode: "test" }, status: "open", payment_status: "unpaid", payment_intent: "pi_fixture", url: "https://checkout.stripe.com/c/pay/cs_test_fixture", ...overrides } as unknown as Stripe.Checkout.Session;
}
const evt = (id: string, type = "checkout.session.completed", object: unknown = session({ payment_status: "paid", status: "complete" })) => ({ id, livemode: false, type, data: { object } }) as Stripe.Event;
function fakeStripe() {
  return { checkout: { sessions: { create: vi.fn(async () => session()), retrieve: vi.fn(async () => session()) } } };
}
beforeEach(() => {
  db = openDb(":memory:");
  db.exec("INSERT INTO users(id,email,name,password_hash) VALUES(1,'one@test.invalid','One','fake'),(2,'two@test.invalid','Two','fake'); INSERT INTO campaigns(id,name) VALUES(1,'Test'); INSERT INTO billing_integration_ack VALUES(1,'fixture','tests','2026-01-01');");
  db.exec("INSERT INTO billing_model_rates(id,model,input_micros_per_million,output_micros_per_million,verified,source,created_at) VALUES(2,'fixture-model',1000000,1000000,1,'test-only','2026-01-01T00:00:00.000Z');");
  saveCeiling(db, 1, 1000000000, jan); claimResource(db, 1, "campaign", 1, jan);
  reserveUsage(db, { userId: 1, operationId: "op", provider: "ai", model: "fixture-model", maxCostMicros: 10000000, source: { campaignId: 1 }, now: jan });
  settleUsage(db, "op", [{ eventKey: "usage", userId: 1, occurredAt: jan, kind: "ai_input_tokens", quantity: 10000000, unitCostMicros: 1000000, unitQuantity: 1000000, costMicros: 10000000, providerRef: "req", model: "fixture-model", rateId: 2, tokenCategory: "input" as const, source: { campaignId: 1 } }], jan);
  const row = finalizeStatement(db, 1, "2026-01-01", feb); statementId = row.id; amount = row.total_cents;
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
describe("test-only hosted checkout", () => {
  it("never accepts live keys, unsafe checkout URLs or production simulators", () => {
    expect(() => testStripe("sk_live_forbidden")).toThrow(); expect(() => testStripe("")).toThrow();
    expect(checkoutUrlAllowed("https://evil.test")).toBe(false);
    expect(checkoutUrlAllowed("https://checkout.stripe.com.evil.test")).toBe(false);
    expect(checkoutUrlAllowed("https://checkout.stripe.com/c/pay/cs_test_x")).toBe(true);
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BILLING_TEST_API_BASE", "http://127.0.0.1:3333"); vi.stubEnv("OUTREACH_SMOKE_MODE", "");
    expect(() => localTestApi()).toThrow();
    vi.stubEnv("OUTREACH_SMOKE_MODE", "1");
    expect(localTestApi()).toBe("http://127.0.0.1:3333");
  });
  it("freezes the total, authorizes the payer and uses one durable idempotency key", async () => {
    const fake = fakeStripe(), sdk = fake as unknown as Stripe;
    await expect(createCheckout(db, 2, statementId, sdk)).rejects.toThrow();
    const results = await Promise.all([createCheckout(db, 1, statementId, sdk), createCheckout(db, 1, statementId, sdk)]);
    expect(results[0]).toBe(results[1]);
    const call = fake.checkout.sessions.create.mock.calls[0] as unknown as [{ line_items: { price_data: { unit_amount: number }; quantity: number }[]; mode: string }, { idempotencyKey: string }];
    expect(call[0].line_items[0].price_data.unit_amount).toBe(amount);
    expect(call[0].mode).toBe("payment");
    expect(call[1].idempotencyKey).toBe(`billing-test-statement-${statementId}-attempt-1`);
    const keys = fake.checkout.sessions.create.mock.calls.map(c => (c as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect((db.prepare("SELECT count(*) n FROM billing_checkout_attempts").get() as { n: number }).n).toBe(1);
  });
  it("rejects tampered provider amounts, currencies, live sessions and metadata", async () => {
    for (const override of [{ amount_total: amount + 1 }, { currency: "eur" }, { livemode: true }, { metadata: {} }]) {
      const fake = fakeStripe(); fake.checkout.sessions.create.mockResolvedValue(session(override));
      await expect(createCheckout(db, 1, statementId, fake as unknown as Stripe)).rejects.toThrow();
    }
  });
  it("does not reuse an unresolved key after the provider retention window", async () => {
    db.prepare("INSERT INTO billing_checkout_attempts(statement_id,attempt,status,created_at) VALUES(?,1,'creating','2025-01-01T00:00:00Z')").run(statementId);
    const fake = fakeStripe();
    await expect(createCheckout(db, 1, statementId, fake as unknown as Stripe)).rejects.toThrow("reconciliation");
    expect(fake.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("keeps a creating attempt after a timeout rather than retrying with a new key", async () => {
    const fake = fakeStripe(); fake.checkout.sessions.create.mockRejectedValueOnce(new Error("timeout"));
    await expect(createCheckout(db, 1, statementId, fake as unknown as Stripe)).rejects.toThrow();
    await createCheckout(db, 1, statementId, fake as unknown as Stripe);
    expect((db.prepare("SELECT max(attempt) n FROM billing_checkout_attempts").get() as { n: number }).n).toBe(1);
  });
});
describe("signed payments, duplicate delivery and fees", () => {
  it("verifies the raw payload signature and rejects replayed timestamps, tampering and live events", () => {
    const sdk = new Stripe("sk_test_signatures"), secret = "whsec_fixture";
    const payload = JSON.stringify(evt("evt-signature"));
    const signature = sdk.webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyWebhook(payload, signature, secret).id).toBe("evt-signature");
    expect(() => verifyWebhook(payload + " ", signature, secret)).toThrow();
    expect(() => verifyWebhook(payload, sdk.webhooks.generateTestHeaderString({ payload, secret, timestamp: 1 }), secret)).toThrow();
    const live = JSON.stringify({ ...evt("live"), livemode: true });
    expect(() => verifyWebhook(live, sdk.webhooks.generateTestHeaderString({ payload: live, secret }), secret)).toThrow();
  });
  it("deduplicates paid events and cannot regress a paid statement to failed/expired", async () => {
    await createCheckout(db, 1, statementId, fakeStripe() as unknown as Stripe);
    processWebhook(db, evt("paid-1"), feb); processWebhook(db, evt("paid-1"), feb); processWebhook(db, evt("paid-2"), feb);
    expect(isPaid(db, statementId)).toBe(true);
    processWebhook(db, evt("expired", "checkout.session.expired", session({ status: "expired" })), feb);
    expect(isPaid(db, statementId)).toBe(true);
    expect(billingHold(db, 1, "2026-02-08T00:00:00Z")).toBe(null);
    expect((db.prepare("SELECT count(*) n FROM billing_payments").get() as { n: number }).n).toBe(1);
    await expect(createCheckout(db, 1, statementId, fakeStripe() as unknown as Stripe)).rejects.toThrow();
  });
  it("does not mark unpaid completion, a bad amount or an unregistered session paid", async () => {
    expect(() => processWebhook(db, evt("unknown"), feb)).toThrow();
    await createCheckout(db, 1, statementId, fakeStripe() as unknown as Stripe);
    processWebhook(db, evt("unpaid", "checkout.session.completed", session()), feb);
    expect(isPaid(db, statementId)).toBe(false);
    expect(() => processWebhook(db, evt("bad", "checkout.session.completed", session({ amount_total: amount + 1, payment_status: "paid" })), feb)).toThrow();
    expect(isPaid(db, statementId)).toBe(false);
    expect(billingHold(db, 1, "2026-02-08T00:00:00Z")).toContain("unpaid");
  });
  it("reconciles actual processor fees exactly once as the next statement’s signed adjustment", async () => {
    await createCheckout(db, 1, statementId, fakeStripe() as unknown as Stripe);
    processWebhook(db, evt("paid"), feb);
    const payment = db.prepare("SELECT id,estimated_fee_micros FROM billing_payments").get() as { id: number; estimated_fee_micros: number };
    const fee = Math.round(payment.estimated_fee_micros / 10000) - 2;
    reconcileFee(db, payment.id, { id: "txn_fixture", fee, currency: "usd" }, feb);
    reconcileFee(db, payment.id, { id: "txn_fixture", fee, currency: "usd" }, feb);
    const next = finalizeStatement(db, 1, "2026-02-01", "2026-03-01T00:00:00Z");
    expect(breakdown(next).adjustmentMicros).toBe(-20000);
    expect(next.total_cents).toBe(0);
    expect(() => reconcileFee(db, payment.id, { id: "txn_other", fee: fee + 1, currency: "usd" }, feb)).toThrow();
  });
  it("retries missing fee evidence without treating it as zero", async () => {
    await createCheckout(db, 1, statementId, fakeStripe() as unknown as Stripe); processWebhook(db, evt("paid"), feb);
    const retrieve = vi.fn(async () => ({ livemode: false, currency: "usd", amount_received: amount, status: "succeeded", latest_charge: null }));
    expect(await reconcilePendingFees(db, { paymentIntents: { retrieve } } as unknown as Stripe)).toBe(0);
    expect((db.prepare("SELECT count(*) n FROM billing_fee_reconciliations").get() as { n: number }).n).toBe(0);
  });
});
