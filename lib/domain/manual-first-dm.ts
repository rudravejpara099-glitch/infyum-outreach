/** Checks a human-written first DM without calling the paid AI provider. */
export function manualFirstDmError(parts: string[], portfolioLink: string): string | null {
  if (parts.length !== 3 || parts.some((part) => !part.trim())) return "Write all three parts of the first message.";
  if (parts.some((part) => part.length > 380)) return "Keep each message part under 380 characters.";
  const urls = parts.flatMap((part) => part.match(/https?:\/\/\S+/gi) ?? []);
  if (urls.length !== 1 || urls[0].replace(/[),.!]+$/, "") !== portfolioLink || !parts[1].includes(portfolioLink)) {
    return `Put the campaign link exactly once in message 2: ${portfolioLink}`;
  }
  return null;
}
