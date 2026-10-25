import { isInstalledLocalModel, localAiModel, localRequestOutputLimit, localMessageFormat } from "@/lib/domain/local-ai";
import type { AiEngine, MeteredAiCall } from "./types";

const LOCAL_ORIGIN = "http://127.0.0.1:11434";
const MAX_RESPONSE_BYTES = 20_000;
const MAX_METADATA_BYTES = 128_000;
type Fetcher = typeof fetch;
function validateRequest(body: unknown, timeoutMs: number): string | undefined {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("The local writing timeout must be at most two minutes.");
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && Buffer.byteLength(encoded, "utf8") > 30_000) throw new Error("This local writing request exceeds the input limit.");
  return encoded;
}
/** Only an installed model on this computer is used. There is no paid-provider fallback. */
export class LocalEngine implements AiEngine {
  constructor(private readonly options: { model?: string; fetcher?: Fetcher; readinessTimeoutMs?: number } = {}) {}
  private model(): string { return localAiModel(this.options.model ?? process.env.LOCAL_AI_MODEL); }

  private async request(path: "/api/tags" | "/api/chat", body?: unknown, timeoutMs = 120_000): Promise<unknown> {
    const encoded = validateRequest(body, timeoutMs);
    const maxBytes = path === "/api/tags" ? MAX_METADATA_BYTES : MAX_RESPONSE_BYTES;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (this.options.fetcher ?? fetch)(`${LOCAL_ORIGIN}${path}`, {
        method: encoded === undefined ? "GET" : "POST", redirect: "error", signal: controller.signal,
        ...(encoded === undefined ? {} : { headers: { "content-type": "application/json" }, body: encoded }),
      });
      if (!response.ok || !response.body) throw new Error("Local writing is unavailable.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new Error("Local writing response exceeds the size limit."); }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Local writing is unavailable or returned an invalid response. Start Ollama and check the installed model. No paid provider was used.");
    } finally { clearTimeout(timer); }
  }

  async assertReady(): Promise<void> {
    const model = this.model();
    const response = await this.request("/api/tags", undefined, this.options.readinessTimeoutMs) as { models?: unknown } | null;
    if (!response || !Array.isArray(response.models) || !response.models.some(item => isInstalledLocalModel(item, model))) {
      throw new Error(`The local writing model ${model} is not installed as a verified local model. Install its local GGUF version before starting preparation. No paid provider was used.`);
    }
  }

  async complete(input: { system: string; prompt: string; timeoutMs?: number; maxOutputTokens?: number; format?: "dm" | "followup"; metering?: MeteredAiCall }): Promise<string> {
    const model = this.model();
    const body = {
      model, messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }],
      ...(input.format ? { format: localMessageFormat(input.format) } : {}),
      stream: false, think: false, options: { num_predict: localRequestOutputLimit(input.maxOutputTokens, input.metering?.maxOutputTokens), num_ctx: 16_384, temperature: 0.2 },
    };
    const timeoutMs = input.timeoutMs ?? 120_000;
    validateRequest(body, timeoutMs);
    // Recheck every time: a name can be replaced with a cloud alias after startup.
    await this.assertReady();
    const response = await this.request("/api/chat", body, timeoutMs) as { message?: { content?: unknown }; done?: unknown; done_reason?: unknown } | null;
    if (response?.done_reason === "length") throw new Error("Local writing reached its output limit. No incomplete text was accepted or paid provider used.");
    if (!response || response.done !== true || typeof response.message?.content !== "string" || !response.message.content.trim()) throw new Error("Local writing returned no complete text. No paid provider was used.");
    return response.message.content.trim();
  }
}
