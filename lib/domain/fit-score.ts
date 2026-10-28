// A 0 to 100 score for "would a funnel and booking page help this prospect, and can they afford it".
// Pure helpers: the prompt, and a strict reader for the model's answer.
export type FitInput = { handle: string; followers: number | null; niche: string; notes: string };
export type FitResult = { score: number; reason: string };

export const FIT_SYSTEM = `You judge whether an Instagram account is a good prospect for a small team that builds sales funnels and booking pages.
Good prospects sell a coaching, consulting or service offer to the public, have a clear way to book or buy, and look able to pay a few hundred dollars. Poor prospects are private people, big brands, agencies, competitors, or accounts with no offer.
Judge only from the material given. Never invent facts.
Answer with JSON only: {"score": <whole number 0 to 100>, "reason": "<one short sentence>"}`;

export function fitPrompt(input: FitInput): string {
  return [
    `Handle: @${input.handle}`,
    `Followers: ${input.followers ?? "unknown"}`,
    input.niche ? `Niche: ${input.niche}` : "",
    `Profile notes (bio, link, recent posts):\n${input.notes.slice(0, 1500) || "(none)"}`,
  ].filter(Boolean).join("\n");
}

/** Accepts only a clean {score, reason}; anything else is rejected so the caller can retry. */
export function parseFit(raw: string): FitResult | null {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const { score, reason } = value as { score?: unknown; reason?: unknown };
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) return null;
  const why = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  return { score: Math.round(score), reason: why.slice(0, 300) };
}
