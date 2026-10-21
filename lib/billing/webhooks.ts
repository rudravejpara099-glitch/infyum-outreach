import { BillingError } from "./errors";
import type Stripe from "stripe";
import type { Db } from "@/lib/db/core";
import { breakdown, getStatement } from "./statements";
import { validateSession } from "./checkout";
import { integer } from "./money";
type Payment = { id: number; statement_id: number; payment_intent_id: string; charge_id: string | null; estimated_fee_micros: number; amount_cents: number };
export function reconcileFee(db: Db, paymentId: number, balance: { id: string; fee: number; currency: string }, now = new Date().toISOString()): void {
  db.transaction(() => {
    const payment = db.prepare("SELECT * FROM billing_payments WHERE id=?").get(paymentId) as Payment | undefined;
    if (!payment || balance.currency !== "usd" || !balance.id) throw new BillingError("Invalid payment fee evidence");
    integer(balance.fee);
    const feeMicros = integer(balance.fee * 10000);
    const prior = db.prepare("SELECT * FROM billing_fee_reconciliations WHERE payment_id=?").get(payment.id) as { balance_transaction_id: string; actual_fee_micros: number } | undefined;
    if (prior) {
      if (prior.balance_transaction_id !== balance.id || prior.actual_fee_micros !== feeMicros) throw new BillingError("Conflicting processor fee evidence");
      return;
    }
    const row = getStatement(db, payment.statement_id)!;
    db.prepare("INSERT INTO billing_fee_reconciliations(payment_id,balance_transaction_id,actual_fee_micros,created_at) VALUES(?,?,?,?)").run(payment.id, balance.id, feeMicros, now);
    const adjustment = feeMicros - payment.estimated_fee_micros;
    db.prepare("INSERT INTO billing_adjustments(user_id,event_key,cost_micros,reason,created_at) VALUES(?,?,?,?,?)").run(row.user_id, `stripe-fee:${balance.id}`, adjustment, `Processor fee reconciliation for statement ${row.id}`, now);
  }).immediate();
}
/** Call only after SDK signature validation; ignored events still deduplicate durably. */
export function processWebhook(db: Db, event: Stripe.Event, now = new Date().toISOString()): void {
  if (event.livemode !== false || !event.id) throw new BillingError("Only signed test-mode events are accepted");
  db.transaction(() => {
    if (db.prepare("SELECT event_id FROM billing_webhook_events WHERE event_id=?").get(event.id)) return;
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const row = getStatement(db, Number(session.metadata?.statement_id));
      if (!row) throw new BillingError("Unknown statement");
      validateSession(session, row.id, row.user_id, row.total_cents);
      const attempt = db.prepare("SELECT * FROM billing_checkout_attempts WHERE session_id=? AND statement_id=?").get(session.id, row.id) as { id: number } | undefined;
      // A crash after provider creation but before saving the session ID must be retried with the same idempotency key first.
      if (!attempt) throw new BillingError("Checkout session is not registered; retry after reconciliation");
      if (session.payment_status === "paid" && ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (!intent || !row.total_cents) throw new BillingError("Missing payment evidence");
        const existing = db.prepare("SELECT * FROM billing_payments WHERE statement_id=?").get(row.id) as { session_id: string; payment_intent_id: string } | undefined;
        if (existing && (existing.session_id !== session.id || existing.payment_intent_id !== intent)) throw new BillingError("A different payment already paid this statement; owner review required");
        if (!existing) db.prepare("INSERT INTO billing_payments(statement_id,session_id,payment_intent_id,amount_cents,estimated_fee_micros,received_at) VALUES(?,?,?,?,?,?)").run(row.id, session.id, intent, row.total_cents, breakdown(row).feeMicros, now);
        db.prepare("UPDATE billing_checkout_attempts SET status='paid' WHERE id=?").run(attempt.id);
      } else if (event.type === "checkout.session.expired") db.prepare("UPDATE billing_checkout_attempts SET status='expired' WHERE id=? AND status!='paid'").run(attempt.id);
    } else if (event.type === "charge.succeeded" || event.type === "charge.updated") {
      const charge = event.data.object as Stripe.Charge;
      const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      const payment = db.prepare("SELECT * FROM billing_payments WHERE payment_intent_id=?").get(intent ?? "") as Payment | undefined;
      if (!payment) {
        if (charge.metadata?.billing_mode === "test") throw new BillingError("Payment not registered yet; retry webhook");
        db.prepare("INSERT INTO billing_webhook_events VALUES(?,?,?)").run(event.id, event.type, now); return;
      }
      if (charge.livemode !== false || charge.currency !== "usd" || charge.amount !== payment.amount_cents || !charge.paid) throw new BillingError("Charge does not match payment");
      const balance = charge.balance_transaction;
      if (balance && typeof balance !== "string") reconcileFee(db, payment.id, balance, now);
    }
    db.prepare("INSERT INTO billing_webhook_events VALUES(?,?,?)").run(event.id, event.type, now);
  }).immediate();
}
export async function reconcilePendingFees(db: Db, stripe: Stripe): Promise<number> {
  const pending = db.prepare("SELECT * FROM billing_payments WHERE id NOT IN(SELECT payment_id FROM billing_fee_reconciliations)").all() as Payment[];
  let count = 0;
  for (const payment of pending) {
    const intent = await stripe.paymentIntents.retrieve(payment.payment_intent_id, { expand: ["latest_charge.balance_transaction"] });
    if (intent.livemode !== false || intent.currency !== "usd" || intent.amount_received !== payment.amount_cents || intent.status !== "succeeded") throw new BillingError("Invalid test payment reconciliation");
    const charge = intent.latest_charge;
    if (charge && typeof charge !== "string" && charge.balance_transaction && typeof charge.balance_transaction !== "string") { reconcileFee(db, payment.id, charge.balance_transaction); count++; }
  }
  return count;
}
