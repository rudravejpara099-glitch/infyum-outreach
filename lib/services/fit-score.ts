import type { AiEngine } from "@/lib/engine/types";
import { FIT_SYSTEM, fitPrompt, parseFit, type FitInput, type FitResult } from "@/lib/domain/fit-score";

/** Asks the writer for a fit score. Retries once on an unreadable answer; returns null if it still cannot be read. */
export async function scoreFit(engine: AiEngine, input: FitInput): Promise<FitResult | null> {
  const prompt = fitPrompt(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await engine.complete({
      system: FIT_SYSTEM,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nYour last answer was not valid. Reply with only {"score": 0-100, "reason": "..."}.`,
      maxOutputTokens: 120,
    });
    const parsed = parseFit(raw);
    if (parsed) return parsed;
  }
  return null;
}
