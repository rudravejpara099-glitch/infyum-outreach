import { BillingError } from "./errors";
import type Stripe from "stripe";
import type { Db } from "@/lib/db/core";
import { getStatement, isPaid } from "./statements";
import { appOrigin, checkoutUrlAllowed, testStripe } from "./provider";
export async function createCheckout(db: Db, userId: number, statementId: number, stripe: Stripe = testStripe()): Promise<string> {
  const row = getStatement(db, statementId);
  if (!row || row.user_id !== userId) throw new BillingError("Statement not found");
  if (!row.total_cents || isPaid(db, row.id)) throw new BillingError("This statement has no payment due");
  let attempt = db.transaction(() => {
    const active = db.prepare("SELECT * FROM billing_checkout_attempts WHERE statement_id=? AND status IN ('creating','open')").get(row.id) as Attempt | undefined;
    if (active) return active;
    const next = (db.prepare("SELECT coalesce(max(attempt),0)+1 n FROM billing_checkout_attempts WHERE statement_id=?").get(row.id) as { n: number }).n;
    const id = Number(db.prepare("INSERT INTO billing_checkout_attempts(statement_id,attempt,status,created_at) VALUES(?,?,'creating',?)").run(row.id, next, new Date().toISOString()).lastInsertRowid);
    return db.prepare("SELECT * FROM billing_checkout_attempts WHERE id=?").get(id) as Attempt;
  }).immediate();
  if (attempt.session_id) {
    const current = await stripe.checkout.sessions.retrieve(attempt.session_id);
    validateSession(current, row.id, userId, row.total_cents);
    if (current.status === "expired") {
      db.prepare("UPDATE billing_checkout_attempts SET status='expired' WHERE id=? AND status='open'").run(attempt.id);
      return createCheckout(db, userId, statementId, stripe);
    }
    if (current.payment_status === "paid" || current.status !== "open") throw new BillingError("Payment is still being confirmed. Check this statement again shortly.");
    if (!current.url || !checkoutUrlAllowed(current.url)) throw new BillingError("Invalid hosted checkout URL");
    return current.url;
  }
  if (Date.now() - Date.parse(attempt.created_at) > 20 * 3600000) throw new BillingError("An unresolved checkout needs owner reconciliation before retrying. No new payment was created.");
  const metadata = { statement_id: String(row.id), user_id: String(userId), billing_mode: "test" };
  const session = await stripe.checkout.sessions.create({ mode: "payment", ui_mode: "hosted_page", allowed_payment_method_types: ["card"], client_reference_id: String(row.id), metadata,
    payment_intent_data: { metadata }, automatic_tax: { enabled: false }, allow_promotion_codes: false,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: row.total_cents, product_data: { name: `Usage statement · ${row.period_start.slice(0, 7)} · TEST`, description: "Actual usage and estimated processor fee; reviewed breakdown is available in your statement." } } }],
    success_url: `${appOrigin()}/billing/statements/${row.id}?checkout=returned`, cancel_url: `${appOrigin()}/billing/statements/${row.id}?checkout=cancelled`,
  }, { idempotencyKey: `billing-test-statement-${row.id}-attempt-${attempt.attempt}` });
  validateSession(session, row.id, userId, row.total_cents);
  if (!session.url || !checkoutUrlAllowed(session.url)) throw new BillingError("Invalid hosted checkout URL");
  db.prepare("UPDATE billing_checkout_attempts SET session_id=?,session_url=?,status='open' WHERE id=? AND status='creating'").run(session.id, session.url, attempt.id);
  attempt = db.prepare("SELECT * FROM billing_checkout_attempts WHERE id=?").get(attempt.id) as Attempt;
  return attempt.session_url!;
}
export function validateSession(session: Stripe.Checkout.Session, statementId: number, userId: number, amount: number): void {
  if (session.livemode !== false || session.mode !== "payment" || session.currency !== "usd" || session.amount_total !== amount || session.metadata?.statement_id !== String(statementId) || session.metadata?.user_id !== String(userId) || session.metadata?.billing_mode !== "test" || session.client_reference_id !== String(statementId)) throw new BillingError("Payment session does not match the frozen statement");
}
type Attempt = { id: number; statement_id: number; attempt: number; session_id: string | null; session_url: string | null; status: string; created_at: string };
