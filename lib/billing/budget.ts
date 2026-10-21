import { BillingError } from "./errors";
import type { Db } from "@/lib/db/core";
import type { Reservation, Source, UsageEvent } from "./types";
import { profile, billingConfig, integrationReady, verifiedModelRate } from "./config";
import { assertAttribution } from "./attribution";
import { committedMicros } from "./resources";
import { periodFor } from "./periods";
import { statement } from "./statement";
import { listStatements, statementState } from "./statements";
import { integer, parseUsd, sum } from "./money";
import { canReserve } from "./rules";
import { syncBilling } from "./sync";
import { recordUsage, sourceJson } from "./ledger";
const total = (db: Db, sql: string, ...args: (string | number)[]) => integer((db.prepare(sql).get(...args) as { n: number }).n);
export function budgetSnapshot(db: Db, userId: number, now = new Date().toISOString()) {
  const period = periodFor(now), cfg = billingConfig(db, now), p = profile(db, userId);
  const usageMicros = total(db, "SELECT coalesce(sum(cost_micros),0) n FROM billing_usage_events WHERE user_id=? AND occurred_at>=? AND occurred_at<?", userId, period.start, period.end);
  const heldMicros = total(db, "SELECT coalesce(sum(max_cost_micros),0) n FROM billing_reservations WHERE user_id=? AND status='held'", userId);
  const commitmentsMicros = committedMicros(db, userId, now);
  const adjustmentMicros = Math.max(0, total(db, "SELECT coalesce(sum(cost_micros),0) n FROM billing_adjustments WHERE user_id=? AND id NOT IN(SELECT adjustment_id FROM billing_statement_adjustments)", userId));
  const baseMicros = sum([usageMicros, heldMicros, commitmentsMicros]);
  const projected = statement({ events: [{ kind: "usage", costMicros: baseMicros }], adjustmentMicros, markupPercent: cfg.markup_percent, feeBps: cfg.fee_bps, fixedFeeMicros: cfg.fixed_fee_micros, minimumCents: 1 });
  const projectedMicros = Math.max(baseMicros, projected.totalCents * 10000);
  return { usageMicros, heldMicros, commitmentsMicros, adjustmentMicros, projectedMicros, ceilingMicros: p?.ceiling_micros ?? 0, consent: !!p?.consented_at };
}
export function billingHold(db: Db, userId: number, now = new Date().toISOString()): string | null {
  const snapshot = budgetSnapshot(db, userId, now);
  if (!snapshot.consent || !snapshot.ceilingMicros) return "Paid work is off. Set your monthly spending limit first.";
  if (!integrationReady(db)) return "Paid work is paused until the metering integration is reviewed and connected.";
  if (db.prepare("SELECT operation_id FROM billing_reservations WHERE user_id=? AND status='settled' AND actual_cost_micros>max_cost_micros LIMIT 1").get(userId)) return "A provider exceeded its reserved cost. Paid work is paused for owner review.";
  if (listStatements(db, userId).some(row => statementState(db, row, now) === "Overdue")) return "An unpaid statement is overdue. Pay it to resume paid work.";
  if (!canReserve(snapshot)) return "Your monthly spending limit is approaching or reached. New paid work is paused at 90%.";
  return null;
}
export function reserveUsage(db: Db, input: { userId: number; operationId: string; provider: "ai" | "apify"; model?: string; maxCostMicros: number; source: Source; now?: string; apifyMonthlyUsageMicros?: number; apifyUsageObservedAt?: string }): Reservation & { fresh: boolean } {
  const now = input.now ?? new Date().toISOString();
  return db.transaction(() => {
    integer(input.maxCostMicros);
    if (!input.maxCostMicros || !input.operationId || input.operationId.length > 240 || !["ai", "apify"].includes(input.provider)) throw new BillingError("A stable operation ID and bounded maximum cost are required");
    assertAttribution(db, input.userId, input.source, now);
    const source = sourceJson(input.source);
    const rate = input.provider === "ai" ? verifiedModelRate(db, input.model ?? "") : null;
    const prior = db.prepare("SELECT * FROM billing_reservations WHERE operation_id=?").get(input.operationId) as Reservation | undefined;
    if (prior) {
      if (prior.user_id !== input.userId || prior.provider !== input.provider || prior.model !== (input.provider === "ai" ? input.model : null) || prior.max_cost_micros !== input.maxCostMicros || prior.source_json !== source) throw new BillingError("Conflicting reservation replay");
      if (prior.status !== "held") throw new BillingError("This operation has already settled; do not dispatch it again");
      return { ...prior, fresh: false };
    }
    syncBilling(db, input.userId, now);
    const hold = billingHold(db, input.userId, now); if (hold) throw new BillingError(hold);
    const cfg = billingConfig(db, now), current = budgetSnapshot(db, input.userId, now);
    const projected = statement({ events: [{ kind: "usage", costMicros: sum([current.usageMicros, current.heldMicros, current.commitmentsMicros, input.maxCostMicros]) }], adjustmentMicros: current.adjustmentMicros, markupPercent: cfg.markup_percent, feeBps: cfg.fee_bps, fixedFeeMicros: cfg.fixed_fee_micros, minimumCents: 1 });
    if (!canReserve({ ...current, projectedMicros: projected.totalCents * 10000 })) throw new BillingError("This task would reach the 90% spending cutoff");
    if (input.provider === "apify") {
      const setting = db.prepare("SELECT value FROM settings WHERE key='apify_monthly_cap_usd'").get() as { value: string } | undefined;
      if (!setting?.value || input.apifyMonthlyUsageMicros === undefined || !input.apifyUsageObservedAt) throw new BillingError("Apify cap and authoritative current-month usage are required");
      const observed = Date.parse(input.apifyUsageObservedAt), currentTime = Date.parse(now);
      if (!Number.isFinite(observed) || observed > currentTime || currentTime - observed > 30000 || periodFor(input.apifyUsageObservedAt).start !== periodFor(now).start) throw new BillingError("Refresh Apify’s authoritative monthly usage before reserving");
      const cap = parseUsd(setting.value); integer(input.apifyMonthlyUsageMicros);
      const held = total(db, "SELECT coalesce(sum(max_cost_micros),0) n FROM billing_reservations WHERE provider='apify' AND status='held'");
      // A second lane can settle while the monthly-usage request is in flight.
      // Keep those charges counted after their reservations have been released.
      const settledSinceObservation = total(db, "SELECT coalesce(sum(cost_micros),0) n FROM billing_usage_events WHERE kind='apify' AND created_at>=?", new Date(observed).toISOString());
      const used = sum([input.apifyMonthlyUsageMicros, settledSinceObservation, held, input.maxCostMicros]);
      if (BigInt(used) * 10n >= BigInt(cap) * 9n) throw new BillingError("Apify’s monthly cap would be reached");
    }
    db.prepare("INSERT INTO billing_reservations(operation_id,user_id,provider,model,rate_id,max_cost_micros,period_start,source_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(input.operationId, input.userId, input.provider, input.provider === "ai" ? input.model : null, rate?.id ?? null, input.maxCostMicros, periodFor(now).start, source, now);
    return { ...(db.prepare("SELECT * FROM billing_reservations WHERE operation_id=?").get(input.operationId) as Reservation), fresh: true };
  }).immediate();
}
export function settleUsage(db: Db, operationId: string, events: UsageEvent[], now = new Date().toISOString()): void {
  db.transaction(() => {
    const hold = db.prepare("SELECT * FROM billing_reservations WHERE operation_id=?").get(operationId) as Reservation | undefined;
    if (!hold || !events.length) throw new BillingError("Reservation and authoritative usage evidence are required");
    const keys = new Set(events.map(e => e.eventKey)); if (keys.size !== events.length) throw new BillingError("Duplicate event in settlement");
    for (const event of events) {
      if (event.userId !== hold.user_id || sourceJson(event.source) !== hold.source_json || (hold.provider === "apify" ? event.kind !== "apify" : !["ai_input_tokens", "ai_output_tokens"].includes(event.kind))) throw new BillingError("Usage does not match the reservation");
      recordUsage(db, event, operationId, now);
    }
    const recorded = db.prepare("SELECT event_key FROM billing_usage_events WHERE operation_id=?").all(operationId) as { event_key: string }[];
    if (recorded.length !== keys.size || recorded.some(e => !keys.has(e.event_key))) throw new BillingError("Settlement replay does not match all recorded events");
    const actual = sum(events.map(e => e.costMicros));
    if (hold.status !== "held" && hold.actual_cost_micros !== actual) throw new BillingError("Conflicting settled operation");
    if (hold.status === "held") db.prepare("UPDATE billing_reservations SET status='settled',actual_cost_micros=? WHERE operation_id=?").run(actual, operationId);
  }).immediate();
}
export function releaseUsage(db: Db, operationId: string, evidence: { providerRef: string; zeroChargeConfirmed: true }, now = new Date().toISOString()): void {
  if (!evidence.zeroChargeConfirmed || !evidence.providerRef) throw new BillingError("Provider confirmation of zero cost is required");
  const hold = db.prepare("SELECT * FROM billing_reservations WHERE operation_id=?").get(operationId) as Reservation | undefined;
  if (!hold) throw new BillingError("Reservation not found");
  settleUsage(db, operationId, [{ eventKey: `zero:${operationId}`, userId: hold.user_id, occurredAt: hold.created_at, kind: hold.provider === "apify" ? "apify" : "ai_input_tokens", quantity: 0, unitCostMicros: 0, unitQuantity: 1, costMicros: 0, providerRef: evidence.providerRef, ...(hold.provider === "ai" ? { model: hold.model!, rateId: hold.rate_id!, tokenCategory: "input" as const, unitCostMicros: (db.prepare("SELECT input_micros_per_million FROM billing_model_rates WHERE id=?").get(hold.rate_id) as { input_micros_per_million: number }).input_micros_per_million, unitQuantity: 1000000 } : {}), source: JSON.parse(hold.source_json) }], now);
}
