import type { Db } from "@/lib/db/core";
import type { UsageEvent, Source, UsageKind } from "./types";
import { integer, roundedRatio } from "./money";
import { profile, tokenRate } from "./config";
import { assertAttribution } from "./attribution";
const KINDS: UsageKind[] = ["apify", "ai_input_tokens", "ai_output_tokens", "proxy_share", "hosting_share"];
export function recordUsage(db: Db, event: UsageEvent, operationId: string | null = null, now = new Date().toISOString()): number {
  const p = profile(db, event.userId);
  const time = new Date(event.occurredAt);
  if (!p?.consented_at || !Number.isFinite(time.getTime()) || time.getTime() < Date.parse(p.consented_at) || time.getTime() > Date.parse(now)) throw new Error("Usage must be after consent and not in the future");
  if (!KINDS.includes(event.kind) || !event.eventKey || event.eventKey.length > 240 || !event.providerRef || event.providerRef.length > 240) throw new Error("Missing usage evidence");
  integer(event.quantity); integer(event.unitCostMicros); integer(event.unitQuantity); integer(event.costMicros);
  if (!event.unitQuantity || roundedRatio(BigInt(event.quantity) * BigInt(event.unitCostMicros), BigInt(event.unitQuantity)) !== event.costMicros) throw new Error("Usage cost does not match its quantity and rate");
  if (["apify", "ai_input_tokens", "ai_output_tokens"].includes(event.kind) && !operationId) throw new Error("Paid usage requires a reservation");
  if (operationId) assertAttribution(db, event.userId, event.source ?? {});
  const values = [event.userId, time.toISOString(), event.kind, event.quantity, event.unitCostMicros, event.unitQuantity, event.costMicros, event.providerRef, sourceJson(event.source), operationId];
  const existing = db.prepare("SELECT id,user_id,occurred_at,kind,quantity,unit_cost_micros,unit_quantity,cost_micros,provider_ref,source_json,operation_id FROM billing_usage_events WHERE event_key=?").get(event.eventKey) as Record<string, unknown> | undefined;
  if (existing) {
    if (JSON.stringify(Object.values(existing).slice(1)) !== JSON.stringify(values)) throw new Error("Conflicting usage replay");
    return existing.id as number;
  }
  return Number(db.prepare("INSERT INTO billing_usage_events(event_key,user_id,occurred_at,kind,quantity,unit_cost_micros,unit_quantity,cost_micros,provider_ref,source_json,operation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(event.eventKey, ...values, now).lastInsertRowid);
}
export function sourceJson(source: Source = {}): string {
  const clean: Source = {};
  for (const key of ["campaignId", "accountId", "leadId", "jobId"] as const) if (source[key] !== undefined) { integer(source[key]!); if (!source[key]) throw new Error("Invalid source ID"); clean[key] = source[key]; }
  return JSON.stringify(clean);
}
export function tokenEvent(db: Db, input: { eventKey: string; userId: number; occurredAt: string; model: string; category: "input" | "output" | "cache_read" | "cache_write"; tokens: number; providerRef: string; source: Source }): UsageEvent {
  const rate = tokenRate(db, input.model, input.category);
  return { eventKey: input.eventKey, userId: input.userId, occurredAt: input.occurredAt, kind: input.category === "output" ? "ai_output_tokens" : "ai_input_tokens", quantity: input.tokens, unitCostMicros: rate, unitQuantity: 1000000, costMicros: roundedRatio(BigInt(integer(input.tokens)) * BigInt(rate), 1000000n), providerRef: input.providerRef, source: input.source };
}
