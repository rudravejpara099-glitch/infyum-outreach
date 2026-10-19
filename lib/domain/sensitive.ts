// Topics that always wait for a human, even when the approval switch is off.
const TOPICS: { name: string; test: RegExp }[] = [
  { name: "price", test: /\b(price|pricing|cost|how much|quote|fee|fees|rate|rates|retainer)\b|\$\s?\d/i },
  { name: "contract", test: /\b(contract|agreement|terms|nda|sign(ed|ing)?|invoice|payment)\b/i },
  { name: "guarantee", test: /\b(guarantee|refund|results? in \d+|promise)\b/i },
  { name: "dates", test: /\b(deadline|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)|in \d+ (days?|weeks?))\b/i },
  { name: "partnership", test: /\b(partner(ship)?|white.?label|affiliate|reseller|commission|revenue share)\b/i },
  { name: "legal", test: /\b(lawyer|attorney|legal|lawsuit|sue|compliance|ftc|cease)\b/i },
  { name: "upset", test: /\b(stop|unsubscribe|spam|report(ing)? you|harass|annoying|angry|scam|fraud)\b/i },
];

export function sensitiveTopics(text: string): string[] {
  return TOPICS.filter((t) => t.test.test(text)).map((t) => t.name);
}

/** Look at what they wrote and what we plan to send back. */
export function needsHuman(incoming: string, outgoing: string): string[] {
  return [...new Set([...sensitiveTopics(incoming), ...sensitiveTopics(outgoing)])];
}
