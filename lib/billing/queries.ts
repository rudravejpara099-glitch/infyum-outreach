import type { Db } from "@/lib/db/core";
import type { UsageKind } from "./types";
import { billingConfig } from "./config";
import { budgetSnapshot, billingHold } from "./budget";
import { periodFor, isoDay } from "./periods";
import { listStatements, isPaid } from "./statements";
import { statement } from "./statement";
import { roundedRatio, sum } from "./money";
export function usageForPeriod(db: Db, userId: number, start: string, end: string) {
  return db.prepare("SELECT id,occurred_at,kind,quantity,unit_cost_micros,unit_quantity,cost_micros,provider_ref,source_json FROM billing_usage_events WHERE user_id=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at,id").all(userId, start, end) as { id: number; occurred_at: string; kind: UsageKind; quantity: number; unit_cost_micros: number; unit_quantity: number; cost_micros: number; provider_ref: string; source_json: string }[];
}
export function billingOverview(db: Db, userId: number, now = new Date().toISOString()) {
  const period = periodFor(now), cfg = billingConfig(db, now), events = usageForPeriod(db, userId, period.start, period.end);
  const current = statement({ events: events.map(e => ({ kind: e.kind, costMicros: e.cost_micros })), markupPercent: cfg.markup_percent, feeBps: cfg.fee_bps, fixedFeeMicros: cfg.fixed_fee_micros, minimumCents: cfg.minimum_cents });
  const day = isoDay(now), todayMicros = sum(events.filter(e => e.occurred_at.startsWith(day)).map(e => e.cost_micros));
  const snapshot = budgetSnapshot(db, userId, now), statements = listStatements(db, userId);
  const variable = sum(events.filter(e => ["apify", "ai_input_tokens", "ai_output_tokens"].includes(e.kind)).map(e => e.cost_micros));
  const fixed = sum(events.filter(e => ["proxy_share", "hosting_share"].includes(e.kind)).map(e => e.cost_micros));
  const projectionMicros = events.length ? sum([roundedRatio(BigInt(variable) * BigInt(period.days), BigInt(Number(day.slice(8)))), fixed, snapshot.commitmentsMicros]) : null;
  const unpaidMicros = sum(statements.filter(row => row.total_cents && !isPaid(db, row.id)).map(row => row.total_cents * 10000));
  const pendingFees = (db.prepare("SELECT count(*) n FROM billing_payments WHERE statement_id IN(SELECT id FROM billing_statements WHERE user_id=?) AND id NOT IN(SELECT payment_id FROM billing_fee_reconciliations)").get(userId) as { n: number }).n;
  return { period, current, todayMicros, snapshot, projectionMicros, unpaidMicros, statements, pendingFees, hold: billingHold(db, userId, now), events };
}
