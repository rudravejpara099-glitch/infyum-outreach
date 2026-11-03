/** Comments are validated before any Instagram interaction on the post. Length and emojis are free (phase1/GUIDE-FOR-CLAUDE.md, 4.3); only the hard limits remain. */
export function warmupCommentError(text: string): string | null {
  if (/[{}]|```|~~~/.test(text) || /^\s*\[|\]\s*$/.test(text)) return "Comments must be plain text without JSON or code fences.";
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length < 1) return "Comments need at least one word.";
  if (text.length > 300) return "Comments must be 300 characters or fewer.";
  if (/[-‐‑‒–—―#]|https?:\/\//i.test(text)) return "Comments cannot contain dashes, hashtags, or links.";
  return null;
}
