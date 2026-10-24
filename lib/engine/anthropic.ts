import { reserveUsage, settleUsage, tokenEvent } from "@/lib/billing";
import { activeAiModel, verifiedModelRate } from "@/lib/billing/config";
import { tokenCostMicros } from "@/lib/billing/money";
import type { AiEngine, MeteredAiCall } from "./types";
import { assertAttribution } from "@/lib/billing/attribution";
import { billingHold } from "@/lib/billing/budget";

const MAX_INPUT_BYTES = 30_000;
const API_URL = "https://api.anthropic.com/v1/messages";
type Fetcher = typeof fetch;
type ProviderResponse = {
  id?: unknown; model?: unknown; content?: { type?: unknown; text?: unknown }[];
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown };
};

export class AiUsageUncertainError extends Error {
  constructor(message: string) { super(message); this.name = "AiUsageUncertainError"; }
}

/** Paid provider calls are always reserved and metered; this class has no CLI fallback. */
export class AnthropicEngine implements AiEngine {
  constructor(private readonly options: { apiKey?: string; fetcher?: Fetcher; model?: string } = {}) {}

  assertReady(call?: MeteredAiCall): void {
    if (!call) throw new Error("Paid AI needs a metered campaign call");
    if (!(this.options.apiKey ?? process.env.ANTHROPIC_API_KEY)) throw new Error("Paid AI is not connected. Add an Anthropic API key in the local environment.");
    verifiedModelRate(call.db, this.options.model ?? activeAiModel(call.db));
    assertAttribution(call.db, call.userId, call.source);
    const hold = billingHold(call.db, call.userId);
    if (hold) throw new Error(hold);
    if (call.db.prepare("SELECT operation_id FROM billing_reservations WHERE user_id=? AND status='held' AND json_extract(source_json,'$.leadId')=? LIMIT 1").get(call.userId, call.source.leadId)) {
      throw new AiUsageUncertainError("This lead has an unresolved AI charge. Preparation is paused until its usage is reconciled.");
    }
  }

  async complete(input: { system: string; prompt: string; timeoutMs?: number; metering?: MeteredAiCall }): Promise<string> {
    const call = input.metering;
    if (!call) throw new Error("Paid AI needs a metered campaign call");
    const key = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Paid AI is not connected. Add an Anthropic API key in the local environment.");
    const model = this.options.model ?? activeAiModel(call.db);
    const bytes = Buffer.byteLength(input.system, "utf8") + Buffer.byteLength(input.prompt, "utf8");
    if (!Number.isSafeInteger(call.maxOutputTokens) || call.maxOutputTokens < 1 || call.maxOutputTokens > 2000 || bytes > MAX_INPUT_BYTES) {
      throw new Error("This AI request exceeds the safe size limit");
    }

    const rate = verifiedModelRate(call.db, model);
    const unresolved = call.db.prepare("SELECT operation_id FROM billing_reservations WHERE user_id=? AND status='held' AND json_extract(source_json,'$.leadId')=? LIMIT 1").get(call.userId, call.source.leadId);
    if (unresolved) throw new AiUsageUncertainError("This lead has an unresolved AI charge. It will not be sent again until the usage is reconciled.");
    // Reserve for the maximum input byte count and full output allowance before dispatch.
    const maxCostMicros = tokenCostMicros(bytes, rate.input_micros_per_million)
      + tokenCostMicros(call.maxOutputTokens, rate.output_micros_per_million);
    const reservation = reserveUsage(call.db, {
      userId: call.userId, operationId: call.operationId, provider: "ai", model, maxCostMicros, source: call.source,
    });
    if (!reservation.fresh) throw new AiUsageUncertainError("This AI request is already reserved and needs usage reconciliation; it was not sent again.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);
    let response: Response;
    let payload: ProviderResponse;
    try {
      response = await (this.options.fetcher ?? fetch)(API_URL, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: call.maxOutputTokens, system: input.system, messages: [{ role: "user", content: input.prompt }] }),
      });
      payload = await response.json() as ProviderResponse;
    } catch {
      throw new AiUsageUncertainError("The AI provider outcome or usage is unknown. Its reserved cost is held and the request will not be retried automatically.");
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new AiUsageUncertainError("The AI provider did not confirm usage. Its reserved cost is held for review.");
    const usage = payload.usage;
    const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
    if (payload.model !== model || typeof payload.id !== "string" || !payload.id || !usage ||
      !isCount(usage.input_tokens) || !isCount(usage.output_tokens) ||
      !isCount(usage.cache_read_input_tokens ?? 0) || !isCount(usage.cache_creation_input_tokens ?? 0) ||
      usage.cache_creation_input_tokens) {
      throw new AiUsageUncertainError("The AI provider usage did not match a billable price. Its reserved cost is held for review.");
    }
    const text = (payload.content ?? []).filter(part => part.type === "text" && typeof part.text === "string").map(part => part.text as string).join("").trim();
    if (!text) throw new AiUsageUncertainError("The AI provider returned no usable text. Its reserved cost is held for review.");

    const occurredAt = new Date().toISOString();
    const common = { userId: call.userId, occurredAt, model, rateId: reservation.rate_id!, providerRef: payload.id, source: call.source };
    const events = [
      tokenEvent(call.db, { ...common, eventKey: `${call.operationId}:input`, category: "input", tokens: usage.input_tokens }),
      tokenEvent(call.db, { ...common, eventKey: `${call.operationId}:output`, category: "output", tokens: usage.output_tokens }),
    ];
    const cached: number = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
    if (cached) events.push(tokenEvent(call.db, { ...common, eventKey: `${call.operationId}:cache-read`, category: "cache_read", tokens: cached }));
    try { settleUsage(call.db, call.operationId, events, occurredAt); }
    catch { throw new AiUsageUncertainError("The AI provider completed, but usage could not be safely recorded. The reservation is held for reconciliation."); }
    return text;
  }
}
