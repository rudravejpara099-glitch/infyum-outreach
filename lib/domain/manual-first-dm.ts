/** Checks a human-written first DM without calling the paid AI provider. One to three messages; the campaign link is optional. */
export function manualFirstDmError(parts: string[], portfolioLink: string): string | null {
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !part.trim())) return "Write one to three messages for the first contact.";
  if (parts.some((part) => part.length > 380)) return "Keep each message part under 380 characters.";
  const urls = parts.flatMap((part) => part.match(/https?:\/\/\S+/gi) ?? []);
  if (urls.length > 1 || urls.some((url) => url.replace(/[),.!]+$/, "") !== portfolioLink)) {
    return `The only link allowed is the campaign link, at most once: ${portfolioLink}`;
  }
  return null;
}
