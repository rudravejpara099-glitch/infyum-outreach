import "server-only";
import { LocalEngine } from "@/lib/engine/local";
import { writingReadiness } from "@/lib/domain/writing-readiness";

/** A short local-only availability check; never generates text or calls a paid provider. */
export async function getWritingReadiness(paidCredentialsAllowed: boolean) {
  const input = { provider: process.env.AI_PROVIDER, model: process.env.LOCAL_AI_MODEL, localAvailable: false, paidKeyConfigured: paidCredentialsAllowed && Boolean(process.env.ANTHROPIC_API_KEY) };
  if (input.provider === "local") {
    try { await new LocalEngine({ readinessTimeoutMs: 2000 }).assertReady(); input.localAvailable = true; }
    catch { /* Keep the configured state visible without claiming a working model. */ }
  }
  return writingReadiness(input);
}
