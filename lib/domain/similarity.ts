// Blocks messages that look like a copy of something we already sent.
// Two signals: same opening words, or heavy overlap of 3-word phrases.
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(ws: string[], n = 3): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

export function overlap(a: string, b: string): number {
  const sa = shingles(words(a));
  const sb = shingles(words(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / Math.min(sa.size, sb.size);
}

export type SimilarityVerdict = { tooSimilar: false } | { tooSimilar: true; reason: string };

export function checkAgainstRecent(candidate: string, recent: string[], threshold = 0.5): SimilarityVerdict {
  const opening = words(candidate).slice(0, 6).join(" ");
  for (const old of recent) {
    if (opening.length > 0 && opening === words(old).slice(0, 6).join(" ")) {
      return { tooSimilar: true, reason: "Same opening words as a recent message" };
    }
    if (overlap(candidate, old) >= threshold) {
      return { tooSimilar: true, reason: "Too much wording shared with a recent message" };
    }
  }
  return { tooSimilar: false };
}
