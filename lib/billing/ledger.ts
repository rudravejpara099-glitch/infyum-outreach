import { BillingError } from "./errors";
import type { Db } from "@/lib/db/core";
import type { UsageEvent, Source, UsageKind, ModelRate } from "./types";
import { integer, roundedRatio } from "./money";
import { profile, verifiedModelRate } from "./config";
import { assertAttribution } from "./attribution";
const KINDS: UsageKind[] = ["apify", "ai_input_tokens", "ai_output_tokens", "proxy_share", "hosting_share"];
export function recordUsage(db: Db, event: UsageEvent, operationId: string | null = null, now = new Date().toISOString()): number {
  const p = profile(db, event.userId);
  const time = new Date(event.occurredAt);
  if (!p?.consented_at || !Number.isFinite(time.getTime()) || time.getTime() < Date.parse(p.consented_at) || time.getTime() > Date.parse(now)) throw new BillingError("Usage must be after consent and not in the future");
  if (!KINDS.includes(event.kind) || !event.eventKey || event.eventKey.length > 240 || !event.providerRef || event.providerRef.length > 240) throw new BillingError("Missing usage evidence");
  integer(event.quantity); integer(event.unitCostMicros); integer(event.unitQuantity); integer(event.costMicros);
  if (!event.unitQuantity || roundedRatio(BigInt(event.quantity) * BigInt(event.unitCostMicros), BigInt(event.unitQuantity)) !== event.costMicros) throw new BillingError("Usage cost does not match its quantity and rate");
  if (["apify", "ai_input_tokens", "ai_output_tokens"].includes(event.kind) && !operationId) throw new BillingError("Paid usage requires a reservation");
  if (operationId) {
    assertAttribution(db, event.userId, event.source ?? {}, event.occurredAt);
    const hold = db.prepare("SELECT user_id,provider,status,source_json,rate_id,model,created_at FROM billing_reservations WHERE operation_id=?").get(operationId) as { user_id: number; provider: string; status: string; source_json: string; rate_id: number | null; model: string | null; created_at: string } | undefined;
    const repeated = db.prepare("SELECT id FROM billing_usage_events WHERE event_key=?").get(event.eventKey);
    if (hold && Date.parse(event.occurredAt) < Date.parse(hold.created_at)) throw new BillingError("Usage cannot predate its reservation");
    if (hold?.provider === "ai") {
      const rate = db.prepare("SELECT * FROM billing_model_rates WHERE id=?").get(hold.rate_id) as ModelRate | undefined;
      const category = event.tokenCategory;
      if (!rate?.verified || event.model !== hold.model || event.rateId !== hold.rate_id || !category || event.unitQuantity !== 1000000 || event.unitCostMicros !== rate[`${category}_micros_per_million`] || (event.kind === "ai_output_tokens") !== (category === "output")) throw new BillingError("Token usage needs the exact model and rate captured by its reservation");
    }
    if (!hold || hold.user_id !== event.userId || hold.source_json !== sourceJson(event.source) || (hold.status !== "held" && !repeated) || (hold.provider === "apify" ? event.kind !== "apify" : !["ai_input_tokens", "ai_output_tokens"].includes(event.kind))) throw new BillingError("Usage does not match its durable reservation");
  }
  const values = [event.userId, time.toISOString(), event.kind, event.quantity, event.unitCostMicros, event.unitQuantity, event.costMicros, event.providerRef, sourceJson(event.source), operationId, event.model ?? null, event.rateId ?? null, event.tokenCategory ?? null];
  const existing = db.prepare("SELECT id,user_id,occurred_at,kind,quantity,unit_cost_micros,unit_quantity,cost_micros,provider_ref,source_json,operation_id,model,rate_id,token_category FROM billing_usage_events WHERE event_key=?").get(event.eventKey) as Record<string, unknown> | undefined;
  if (existing) {
    if (JSON.stringify(Object.values(existing).slice(1)) !== JSON.stringify(values)) throw new BillingError("Conflicting usage replay");
    return existing.id as number;
  }
  return Number(db.prepare("INSERT INTO billing_usage_events(event_key,user_id,occurred_at,kind,quantity,unit_cost_micros,unit_quantity,cost_micros,provider_ref,source_json,operation_id,model,rate_id,token_category,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(event.eventKey, ...values, now).lastInsertRowid);
}
export function sourceJson(source: Source = {}): string {
  const clean: Source = {};
  for (const key of ["campaignId", "accountId", "leadId", "jobId"] as const) if (source[key] !== undefined) { integer(source[key]!); if (!source[key]) throw new BillingError("Invalid source ID"); clean[key] = source[key]; }
  return JSON.stringify(clean);
}
export function tokenEvent(db: Db, input: { eventKey: string; userId: number; occurredAt: string; model: string; rateId?: number; category: "input" | "output" | "cache_read" | "cache_write"; tokens: number; providerRef: string; source: Source }): UsageEvent {
  const snapshot = input.rateId ? db.prepare("SELECT * FROM billing_model_rates WHERE id=? AND model=? AND verified=1").get(input.rateId, input.model) as ModelRate | undefined : verifiedModelRate(db, input.model);
  if (!snapshot) throw new BillingError("Model price snapshot not found");
  const rate = snapshot[`${input.category}_micros_per_million`];
  if (rate === null) throw new BillingError("This token category has no confirmed rate");
  return { eventKey: input.eventKey, userId: input.userId, occurredAt: input.occurredAt, kind: input.category === "output" ? "ai_output_tokens" : "ai_input_tokens", quantity: input.tokens, unitCostMicros: rate, unitQuantity: 1000000, costMicros: roundedRatio(BigInt(integer(input.tokens)) * BigInt(rate), 1000000n), providerRef: input.providerRef, model: input.model, rateId: snapshot.id, tokenCategory: input.category, source: input.source };
}
