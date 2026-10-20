import type { Db } from "@/lib/db/core";
import type { StatementRow } from "./types";
import type { Statement } from "./statement";
import { statement } from "./statement";
import { billingConfig } from "./config";
import { periodFor, isOverdue } from "./periods";
import { sum } from "./money";
export function listStatements(db: Db, userId: number): StatementRow[] { return db.prepare("SELECT * FROM billing_statements WHERE user_id=? ORDER BY period_start DESC").all(userId) as StatementRow[]; }
export function getStatement(db: Db, id: number): StatementRow | null { return db.prepare("SELECT * FROM billing_statements WHERE id=?").get(id) as StatementRow | undefined ?? null; }
export function isPaid(db: Db, id: number): boolean { return !!db.prepare("SELECT id FROM billing_payments WHERE statement_id=?").get(id); }
export function statementState(db: Db, row: StatementRow, now = new Date().toISOString()): string {
  if (!row.total_cents) return row.carry_micros ? "Carried forward" : "No payment due";
  return isPaid(db, row.id) ? "Paid" : isOverdue(row.created_at, now) ? "Overdue" : "Awaiting payment";
}
export function finalizeStatement(db: Db, userId: number, periodStart: string, now = new Date().toISOString()): StatementRow {
  return db.transaction(() => {
    const period = periodFor(periodStart);
    if (period.start !== periodStart || period.end > now.slice(0, 10)) throw new Error("Only completed calendar months can be finalized");
    const existing = db.prepare("SELECT * FROM billing_statements WHERE user_id=? AND period_start=?").get(userId, period.start) as StatementRow | undefined;
    if (existing) return existing;
    const prior = db.prepare("SELECT * FROM billing_statements WHERE user_id=? ORDER BY period_start DESC LIMIT 1").get(userId) as StatementRow | undefined;
    if (prior && prior.period_start >= period.start) throw new Error("Statements must be generated in order");
    const events = db.prepare("SELECT id,kind,cost_micros FROM billing_usage_events WHERE user_id=? AND occurred_at<? AND id NOT IN(SELECT event_id FROM billing_statement_usage)").all(userId, period.end + "T00:00:00.000Z") as { id: number; kind: string; cost_micros: number }[];
    const adjustments = db.prepare("SELECT id,cost_micros FROM billing_adjustments WHERE user_id=? AND created_at<? AND id NOT IN(SELECT adjustment_id FROM billing_statement_adjustments)").all(userId, period.end + "T00:00:00.000Z") as { id: number; cost_micros: number }[];
    const cfg = billingConfig(db, period.start + "T00:00:00.000Z");
    const result = statement({ events: events.map(e => ({ kind: e.kind, costMicros: e.cost_micros })), carryMicros: prior?.carry_micros ?? 0, adjustmentMicros: sum(adjustments.map(a => a.cost_micros)), markupPercent: cfg.markup_percent, feeBps: cfg.fee_bps, fixedFeeMicros: cfg.fixed_fee_micros, minimumCents: cfg.minimum_cents });
    const id = Number(db.prepare("INSERT INTO billing_statements(user_id,period_start,period_end,breakdown_json,total_cents,carry_micros,previous_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run(userId, period.start, period.end, JSON.stringify(result), result.totalCents, result.carryMicros, prior?.id ?? null, now).lastInsertRowid);
    for (const event of events) db.prepare("INSERT INTO billing_statement_usage VALUES(?,?)").run(id, event.id);
    for (const adjustment of adjustments) db.prepare("INSERT INTO billing_statement_adjustments VALUES(?,?)").run(id, adjustment.id);
    return getStatement(db, id)!;
  }).immediate();
}
export function breakdown(row: StatementRow): Statement { return JSON.parse(row.breakdown_json) as Statement; }
