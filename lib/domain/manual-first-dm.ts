/** Checks a human-written first DM without calling the paid AI provider. Same shape the writer produces: one message, no link. */
export function manualFirstDmError(parts: string[]): string | null {
  if (parts.length !== 1 || !parts[0].trim()) return "Write the first message.";
  if (parts[0].length > 900) return "Keep the message under 900 characters.";
  if (/https?:\/\/\S+/i.test(parts[0])) return "Leave links out of the first message.";
  return null;
}
