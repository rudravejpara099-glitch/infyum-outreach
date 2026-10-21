import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { saveCeiling } from "@/lib/billing/config";
import { claimResource } from "@/lib/billing/attribution";
import { reserveUsage, settleUsage, releaseUsage, budgetSnapshot, billingHold } from "@/lib/billing/budget";
import { recordUsage } from "@/lib/billing/ledger";
import { syncBilling } from "@/lib/billing/sync";
import { addResourceCost } from "@/lib/billing/resources";
import { finalizeStatement, breakdown, listStatements } from "@/lib/billing/statements";
import type { UsageEvent } from "@/lib/billing/types";
let db: Db;
const jan = "2026-01-01T00:00:00.000Z";
const feb = "2026-02-01T00:00:00.000Z";
const input = (operationId = "op-1", maxCostMicros = 1000000) => ({ userId: 1, operationId, maxCostMicros, provider: "ai" as const, model: "fixture-model", source: { campaignId: 1, accountId: 1 }, now: jan });
const event = (cost = 1000000, eventKey = "evt-1"): UsageEvent => ({ eventKey, userId: 1, occurredAt: jan, kind: "ai_input_tokens", quantity: cost, unitCostMicros: 1000000, unitQuantity: 1000000, costMicros: cost, providerRef: "req-1", model: "fixture-model", rateId: 2, tokenCategory: "input", source: { campaignId: 1, accountId: 1 } });
beforeEach(() => {
  process.env.BILLING_OWNER_USER_ID = "1";
  db = openDb(":memory:");
  db.exec("INSERT INTO users(id,email,name,password_hash) VALUES(1,'one@test.invalid','One','fake'),(2,'two@test.invalid','Two','fake'); INSERT INTO campaigns(id,name) VALUES(1,'Test'); INSERT INTO ig_accounts(id,handle,profile_dir) VALUES(1,'test','unused'); INSERT INTO billing_integration_ack VALUES(1,'fixture-only','tests','2026-01-01');");
  db.exec("INSERT INTO billing_model_rates(id,model,input_micros_per_million,output_micros_per_million,verified,source,created_at) VALUES(2,'fixture-model',1000000,1000000,1,'test-only','2026-01-01T00:00:00.000Z');");
  saveCeiling(db, 1, 100000000, jan); saveCeiling(db, 2, 100000000, jan);
  claimResource(db, 1, "campaign", 1, jan); claimResource(db, 1, "account", 1, jan);
});
afterEach(() => { db.close(); delete process.env.BILLING_OWNER_USER_ID; });
describe("durable ledger and reservations", () => {
  it("appends a migration and seeds placeholders without billing old users", () => {
    expect((db.prepare("SELECT count(*) n FROM schema_migrations").get() as { n: number }).n).toBe(2);
    expect((db.prepare("SELECT verified FROM billing_model_rates").get() as { verified: number }).verified).toBe(0);
    expect((db.prepare("SELECT count(*) n FROM billing_usage_events").get() as { n: number }).n).toBe(0);
  });
  it("reserves, settles atomically and accepts identical replay without double billing", () => {
    expect(reserveUsage(db, input()).fresh).toBe(true);
    expect(reserveUsage(db, input()).fresh).toBe(false);
    settleUsage(db, "op-1", [event()], jan);
    settleUsage(db, "op-1", [event()], jan);
    expect(budgetSnapshot(db, 1, jan).usageMicros).toBe(1000000);
    expect(budgetSnapshot(db, 1, jan).heldMicros).toBe(0);
    expect(() => settleUsage(db, "op-1", [event(2)], jan)).toThrow();
    expect(() => reserveUsage(db, input())).toThrow();
  });
  it("refuses wrong attribution, unpaid usage without reservations and conflicting operation keys", () => {
    expect(() => claimResource(db, 2, "campaign", 1, jan)).toThrow();
    expect(() => reserveUsage(db, { ...input(), userId: 2 })).toThrow();
    expect(() => recordUsage(db, event(), null, jan)).toThrow();
    reserveUsage(db, input());
    expect(() => reserveUsage(db, input("op-1", 2))).toThrow();
    expect(() => settleUsage(db, "op-1", [{ ...event(), userId: 2 }], jan)).toThrow();
  });
  it("keeps unresolved reservations, releasing only with explicit zero-charge evidence", () => {
    reserveUsage(db, input());
    expect(budgetSnapshot(db, 1, feb).heldMicros).toBe(1000000);
    expect(() => settleUsage(db, "op-1", [], jan)).toThrow();
    expect(() => releaseUsage(db, "op-1", { providerRef: "", zeroChargeConfirmed: true }, jan)).toThrow();
    releaseUsage(db, "op-1", { providerRef: "provider-confirmed-no-charge", zeroChargeConfirmed: true }, jan);
    expect(budgetSnapshot(db, 1, jan).heldMicros).toBe(0);
  });
  it("checks atomic reservations before work including processing fees", () => {
    saveCeiling(db, 1, 10000000, jan);
    reserveUsage(db, input("a", 4000000));
    expect(() => reserveUsage(db, input("b", 4500000))).toThrow();
    expect(budgetSnapshot(db, 1, jan).heldMicros).toBe(4000000);
  });
  it("records real provider overruns rather than hiding them and holds later work", () => {
    reserveUsage(db, input("a", 1000000));
    settleUsage(db, "a", [event(2000000)], jan);
    expect(budgetSnapshot(db, 1, jan).usageMicros).toBe(2000000);
    expect(billingHold(db, 1, jan)).toContain("exceeded");
  });
  it("requires confirmed integration and fails closed on unknown/global Apify cap usage", () => {
    db.exec("DELETE FROM billing_integration_ack");
    expect(() => reserveUsage(db, input())).toThrow();
    db.exec("INSERT INTO billing_integration_ack VALUES(1,'fixture-only','tests','2026-01-01'); INSERT INTO settings VALUES('apify_monthly_cap_usd','10');");
    expect(() => reserveUsage(db, { ...input(), provider: "apify" })).toThrow();
    reserveUsage(db, { ...input("apify-a"), provider: "apify", apifyMonthlyUsageMicros: 7000000, apifyUsageObservedAt: jan });
    expect(() => reserveUsage(db, { ...input("apify-b"), provider: "apify", apifyMonthlyUsageMicros: 7000000, apifyUsageObservedAt: jan })).toThrow();
  });
  it("counts Apify settlements from another lane after an aggregate observation and refuses stale aggregates", () => {
    db.exec("INSERT INTO settings VALUES('apify_monthly_cap_usd','10')");
    const apify = { ...input("apify-a"), provider: "apify" as const, apifyMonthlyUsageMicros: 7000000, apifyUsageObservedAt: jan };
    reserveUsage(db, apify);
    settleUsage(db, "apify-a", [{ eventKey: "run-a", userId: 1, occurredAt: jan, kind: "apify", quantity: 1, unitCostMicros: 1000000, unitQuantity: 1, costMicros: 1000000, providerRef: "run-a", source: apify.source }], jan);
    expect(() => reserveUsage(db, { ...apify, operationId: "apify-b" })).toThrow("cap");
    expect(() => reserveUsage(db, { ...apify, operationId: "stale", now: "2026-01-01T00:01:00.000Z" })).toThrow("Refresh");
  });
  it("rejects costs predating assignment and requires the model price captured at dispatch", () => {
    expect(() => reserveUsage(db, { ...input(), now: "2025-12-31T00:00:00.000Z" })).toThrow();
    reserveUsage(db, input());
    expect(() => settleUsage(db, "op-1", [{ ...event(), model: "wrong-model" }], jan)).toThrow();
    expect(() => settleUsage(db, "op-1", [{ ...event(), rateId: 1 }], jan)).toThrow();
    db.prepare("INSERT INTO billing_model_rates(model,input_micros_per_million,output_micros_per_million,verified,source,created_at) VALUES('fixture-model',2000000,2000000,1,'new-test-rate',?)").run(feb);
    settleUsage(db, "op-1", [event()], feb);
    expect(budgetSnapshot(db, 1, jan).usageMicros).toBe(1000000);
  });
  it("protects ledger evidence, prices and finalized statements from edits/deletion", () => {
    reserveUsage(db, input()); settleUsage(db, "op-1", [event()], jan);
    finalizeStatement(db, 1, "2026-01-01", feb);
    for (const table of ["billing_usage_events", "billing_model_rates", "billing_config", "billing_statements", "billing_assignments"]) {
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow("append-only");
    }
    expect(() => db.exec("UPDATE billing_usage_events SET cost_micros=0")).toThrow("append-only");
  });
});
describe("actual costs, months and holds", () => {
  it("accrues only confirmed fixed costs, with idempotency and hosting zero locally", () => {
    addResourceCost(db, 1, { userId: 1, accountId: 1, kind: "proxy_share", amountMicros: 10000000, reference: "invoice-1" }, jan);
    syncBilling(db, 1, feb); syncBilling(db, 1, feb);
    const row = listStatements(db, 1)[0];
    expect(breakdown(row).subtotalMicros).toBe(10000000);
    expect(billingHold(db, 1, "2026-02-08T00:00:00Z")).toContain("unpaid");
    expect(() => addResourceCost(db, 1, { userId: 1, kind: "hosting_share", amountMicros: 600000, reference: "hosting" }, jan)).toThrow("locally");
    expect(() => addResourceCost(db, 2, { userId: 1, accountId: 1, kind: "proxy_share", amountMicros: 1, reference: "not-owner" }, jan)).toThrow();
  });
  it("includes future fixed commitments before allowing paid work", () => {
    addResourceCost(db, 1, { userId: 1, accountId: 1, kind: "proxy_share", amountMicros: 10000000, reference: "invoice-1" }, jan);
    saveCeiling(db, 1, 10000000, jan);
    expect(() => reserveUsage(db, input("expensive", 1))).toThrow();
  });
  it("cannot charge historical or future usage and keeps late usage on the next statement", () => {
    reserveUsage(db, input());
    expect(() => settleUsage(db, "op-1", [{ ...event(), occurredAt: "2025-12-31T00:00:00Z" }], jan)).toThrow();
    expect(() => settleUsage(db, "op-1", [{ ...event(), occurredAt: feb }], jan)).toThrow();
    const first = finalizeStatement(db, 1, "2026-01-01", feb);
    expect(first.total_cents).toBe(0);
    settleUsage(db, "op-1", [event()], feb);
    const second = finalizeStatement(db, 1, "2026-02-01", "2026-03-01T00:00:00Z");
    expect(breakdown(second).subtotalMicros).toBe(1000000);
    expect(breakdown(first).subtotalMicros).toBe(0);
    expect(finalizeStatement(db, 1, "2026-02-01", "2026-03-01T00:00:00Z").id).toBe(second.id);
    expect(() => finalizeStatement(db, 1, "2026-03-01", "2026-03-10T00:00:00Z")).toThrow();
  });
});
