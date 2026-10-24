/** Comments are validated before any Instagram interaction on the post. */
export function warmupCommentError(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const emoji = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
    .filter(({ segment }) => /\p{Extended_Pictographic}/u.test(segment)).length;
  if (words.length < 3 || words.length > 8) return "Comments need 3 to 8 words.";
  if (emoji < 1 || emoji > 3) return "Comments need 1 to 3 emojis.";
  if (/[-‐‑‒–—―#]|https?:\/\//i.test(text)) return "Comments cannot contain dashes, hashtags, or links.";
  return null;
}
