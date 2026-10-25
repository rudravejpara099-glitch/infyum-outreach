/** An installed local model name; never a URL, API key, or remote endpoint. */
export function localAiModel(value: string | undefined): string {
  const model = value?.trim();
  if (!model || model.length > 100 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(model)
    || /(?:^|[-_:])cloud(?:$|[-_:])/i.test(model)) {
    throw new Error("Choose an installed local writing model with LOCAL_AI_MODEL before starting automatic preparation.");
  }
  return model;
}
/** Ollama may list cloud-backed aliases locally; names alone do not prove local inference. */
export function isInstalledLocalModel(value: unknown, model: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (entry.name !== model || "remote_host" in entry || "remote_model" in entry
    || !Number.isSafeInteger(entry.size) || Number(entry.size) <= 0) return false;
  const details = entry.details;
  return !!details && typeof details === "object" && !Array.isArray(details)
    && (details as Record<string, unknown>).format === "gguf";
}
export function aiProvider(value: string | undefined): "local" | "anthropic" {
  if (!value || value === "anthropic") return "anthropic";
  if (value === "local") return "local";
  throw new Error("AI_PROVIDER must be local or anthropic. No fallback provider was used.");
}
export function localOutputLimit(value: number | undefined): number {
  const limit = value ?? 1200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("This local writing request exceeds the output limit.");
  return limit;
}

/** Free comments need the same short limit even without a paid metering context. */
export function localRequestOutputLimit(requested?: number, metered?: number): number {
  const limit = localOutputLimit(requested ?? metered);
  return metered === undefined ? limit : Math.min(limit, localOutputLimit(metered));
}

/** Constrain the model to the existing message contract; content is still validated afterward. */
export function localMessageFormat(kind?: "dm" | "followup") {
  if (!kind) return undefined;
  const count = kind === "dm" ? 3 : 1;
  return { type: "object", properties: { parts: { type: "array", items: { type: "string" }, minItems: count, maxItems: count } }, required: ["parts"], additionalProperties: false };
}
