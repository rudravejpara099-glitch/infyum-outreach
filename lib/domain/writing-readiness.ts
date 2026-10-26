import { aiProvider, localAiModel } from "./local-ai";
export type WritingReadiness = { provider: "local" | "anthropic" | "invalid"; available: boolean; title: string; detail: string };
/** Configuration alone never proves that a local model is installed or that generation succeeded. */
export function writingReadiness(input: { provider?: string; model?: string; localAvailable: boolean; paidKeyConfigured: boolean }): WritingReadiness {
  let provider: "local" | "anthropic";
  try { provider = aiProvider(input.provider); } catch { return { provider: "invalid", available: false, title: "Message writing needs setup", detail: "The writing provider setting is invalid. Ask your workspace administrator to choose local or Anthropic writing." }; }
  if (provider === "local") {
    let model: string;
    try { model = localAiModel(input.model); } catch { return { provider, available: false, title: "Choose a local writing model", detail: "Free local writing is selected, but no valid model is configured. Ask your workspace administrator to choose an installed model. Preparation waits until it is available." }; }
    return input.localAvailable
      ? { provider, available: true, title: "Local writing model available", detail: `Ollama is responding and lists ${model} as installed on this server. Writing uses no paid API or personal Claude subscription. A draft has not been tested by this connection check; every draft still follows your campaign approval setting.` }
      : { provider, available: false, title: "Local writing is unavailable", detail: `${model} is configured, but its installation could not be confirmed. Start Ollama on this server and check that this exact model is installed. Automatic preparation waits; no paid provider is used instead.` };
  }
  return input.paidKeyConfigured
    ? { provider, available: true, title: "Paid writing key configured", detail: "An Anthropic API key is set for this workspace. This does not confirm provider access or billing readiness. Paid writing requires metering and approval; no provider request was made by this check." }
    : { provider, available: false, title: "Automatic message drafts are off", detail: "Automatic writing is not connected for this workspace. You can use free local writing when the server administrator installs and selects a model, or a separately metered Anthropic API connection. A personal Claude subscription is not used." };
}
