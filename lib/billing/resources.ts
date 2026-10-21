import { BillingError } from "./errors";
import type { Db } from "@/lib/db/core";
import type { ResourceCost } from "./types";
import { assertOwner, profile } from "./config";
import { payerFor } from "./attribution";
import { daysBetween, isoDay, periodFor } from "./periods";
import { canReserve } from "./rules";
import { billingConfig } from "./config";
import { statement } from "./statement";
import { integer, monthlyShare, sum } from "./money";
export const deployment = () => process.env.BILLING_DEPLOYMENT === "hosted" ? "hosted" : "local";
export function costsForDay(db: Db, userId: number, day: string, mode = deployment()): ResourceCost[] {
  const rows = db.prepare("SELECT * FROM billing_resource_costs WHERE user_id=? AND start_date<=? ORDER BY start_date,id").all(userId, day) as ResourceCost[];
  const current = new Map<string, ResourceCost>();
  for (const row of rows) current.set(`${row.kind}:${row.account_id ?? 0}`, row);
  return [...current.values()].filter(row => (!row.end_date || row.end_date >= day) && (row.kind !== "hosting_share" || mode === "hosted"));
}
export function dayCost(cost: ResourceCost, day: string): number {
  return cost.cadence === "day" ? cost.amount_micros : monthlyShare(cost.amount_micros, Number(day.slice(8)), periodFor(day).days);
}
export function committedMicros(db: Db, userId: number, now: string, mode = deployment()): number {
  const { end } = periodFor(now), today = isoDay(now);
  const last = isoDay(new Date(Date.parse(end + "T00:00:00Z") - 86400000).toISOString());
  return sum(daysBetween(today, last).filter(day => day > today).flatMap(day => costsForDay(db, userId, day, mode).map(row => dayCost(row, day))));
}
export function addResourceCost(db: Db, ownerId: number, input: { userId: number; accountId?: number; kind: "proxy_share" | "hosting_share"; amountMicros: number; reference: string }, now = new Date().toISOString()): void {
  assertOwner(ownerId); integer(input.amountMicros);
  if (!profile(db, input.userId)?.consented_at) throw new BillingError("The payer must accept billing first");
  if (input.kind === "proxy_share" && (!input.accountId || payerFor(db, "account", input.accountId) !== input.userId)) throw new BillingError("The network account must belong to this payer");
  if (input.kind === "hosting_share" && deployment() !== "hosted") throw new BillingError("Hosting is zero while this app runs locally");
  if (!input.reference.trim() || input.reference.length > 240) throw new BillingError("Add a short provider invoice/reference, without credentials");
  const prior = db.prepare("SELECT id FROM billing_resource_costs WHERE user_id=? AND kind=? AND coalesce(account_id,0)=? LIMIT 1").get(input.userId, input.kind, input.accountId ?? 0);
  const start = prior ? isoDay(new Date(Date.parse(isoDay(now) + "T00:00:00Z") + 86400000).toISOString()) : isoDay(now);
  db.transaction(() => {
  db.prepare("INSERT INTO billing_resource_costs(user_id,account_id,kind,cadence,amount_micros,start_date,reference,confirmed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(input.userId, input.kind === "proxy_share" ? input.accountId : null, input.kind, input.kind === "proxy_share" ? "month" : "day", input.amountMicros, start, input.reference.trim(), ownerId, now);
    const period = periodFor(now), cfg = billingConfig(db, now);
    const existing = (db.prepare("SELECT coalesce(sum(cost_micros),0) n FROM billing_usage_events WHERE user_id=? AND occurred_at>=? AND occurred_at<?").get(input.userId, period.start, period.end) as { n: number }).n;
    const held = (db.prepare("SELECT coalesce(sum(max_cost_micros),0) n FROM billing_reservations WHERE user_id=? AND status='held'").get(input.userId) as { n: number }).n;
    const last = isoDay(new Date(Date.parse(period.end + "T00:00:00Z") - 86400000).toISOString());
    const future = sum(daysBetween(isoDay(now), last).flatMap(day => costsForDay(db, input.userId, day).filter(cost => !db.prepare("SELECT id FROM billing_usage_events WHERE event_key=?").get(`fixed:${cost.id}:${day}`)).map(cost => dayCost(cost, day))));
    const projected = statement({ events: [{ kind: "usage", costMicros: sum([existing, held, future]) }], markupPercent: cfg.markup_percent, feeBps: cfg.fee_bps, fixedFeeMicros: cfg.fixed_fee_micros, minimumCents: 1 });
    if (!canReserve({ consent: true, ceilingMicros: profile(db, input.userId)!.ceiling_micros, projectedMicros: projected.totalCents * 10000 })) throw new BillingError("This expense would reach the payer’s spending cutoff. Obtain a higher ceiling or reduce the expense first.");
  }).immediate();
}
