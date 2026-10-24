// Small pure helpers for reading Instagram text. No browser needed, so they are unit tested.

/** "4,728" -> 4728, "13.5K" -> 13500, "2.3M" -> 2300000. Returns null when it is not a count. */
export function parseCount(text: string): number | null {
  const m = text.replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { k: 1_000, m: 1_000_000 }[(m[2] ?? "").toLowerCase() as "k" | "m"] ?? 1;
  return Math.round(n * mult);
}

/** Posts about these topics get a like and no comment. */
const SENSITIVE_POST = /\b(rip|passed away|funeral|grief|mourning|condolence|pray(er|ing|ers)?|god|jesus|bible|church|blessed|election|vote|trump|biden|democrat|republican|gaza|palestin|israel|abortion)\b/i;
export function skipComment(caption: string): boolean {
  return SENSITIVE_POST.test(caption);
}

const BLOCK_SIGNS = [
  /action blocked/i, /try again later/i, /we restrict certain activity/i, /confirm you'?re (a )?human/i,
  /suspicious (activity|login)/i, /your account has been (disabled|suspended|temporarily locked)/i, /help us confirm/i,
];
/** Text on screen that means Instagram is warning us. */
export function looksBlocked(pageText: string, url: string): boolean {
  return /\/(challenge|accounts\/suspended)\//.test(url) || BLOCK_SIGNS.some((r) => r.test(pageText));
}

const LOGIN_PROMPTS = [
  /log in to (?:see|view) (?:photos|posts|this profile|content)/i,
  /sign up to (?:see|view) (?:photos|posts|this profile|content)/i,
  /see photos, videos and more from[\s\S]{0,200}sign up and never miss a post/i,
  /log in to continue/i,
  /you need to log in to continue/i,
];

/** Detects the login modal Instagram can show over an otherwise public profile. */
export function looksLoggedOut(url: string, pageText = ""): boolean {
  return /\/accounts\/login/i.test(url) || LOGIN_PROMPTS.some((pattern) => pattern.test(pageText));
}

/** Session confirmation uses cookie presence only; callers must never retain or log cookie values. */
export function hasInstagramSession(cookies: { name: string; value: string }[], url: string): boolean {
  if (/\/challenge\//i.test(url) || /\/accounts\/login/i.test(url)) return false;
  return cookies.some((cookie) => cookie.name === "sessionid" && cookie.value.length > 0);
}

/** First number that sits next to the word "followers" in header text. */
export function followersFromText(text: string): number | null {
  const m = text.replace(/ /g, " ").match(/([\d.,]+\s*[kKmM]?)\s+followers/);
  return m ? parseCount(m[1]) : null;
}
