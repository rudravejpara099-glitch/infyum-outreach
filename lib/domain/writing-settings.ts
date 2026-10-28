// Build plan, Settings: sender details and the DM and comment prompts are editable. Pure: no database.
export type WritingSettings = {
  senderName: string;
  company: string;
  location: string;
  offer: string;
  /** Instructions for the three first-DM messages. {sender} {company} {location} {offer} {link} are filled in. */
  dmPrompt: string;
  /** Instructions for one comment. */
  commentPrompt: string;
};

export const DEFAULT_DM_PROMPT = `Message 1: speak directly to the recipient using "you" or "your" and mention one specific, true detail about their page or business that proves you looked. No introduction yet.
Message 2: introduce yourself by name as {sender} at {company}, {offer} based in {location}. You MUST include all three names: {sender}, {company}, {location}. Add one honest observation about their funnel and this link exactly once: {link}
Message 3: one curious question about their funnel or business. Nothing else.
Rules: each message under 380 characters. Different wording and shape from the recent openings below. Match their language if their audience is not English. No other links.`;

export const DEFAULT_COMMENT_PROMPT = `Write one short Instagram comment on this post. Use only 4 to 6 words (never more than 8), then 1 to 2 emojis. Specific to the post, warm, no dashes, no hashtags, no questions about business. Never start with "Love this", "Great" or "Nice". Name one concrete detail from the post's own text. Length example only, never reuse its words: "That checklist idea is smart 🙌". Answer with only the comment text.`;

export const DEFAULT_WRITING: WritingSettings = {
  senderName: "Rudra",
  company: "Infyum",
  location: "India",
  offer: "a small team that builds funnels and landing pages",
  dmPrompt: DEFAULT_DM_PROMPT,
  commentPrompt: DEFAULT_COMMENT_PROMPT,
};

const KEYS = Object.keys(DEFAULT_WRITING) as (keyof WritingSettings)[];

/** Blank or missing fields fall back to the defaults, so a half-saved setting never breaks writing. */
export function parseWritingSettings(raw: string | null): WritingSettings {
  let saved: Record<string, unknown> = {};
  try { const v = raw ? JSON.parse(raw) : {}; if (v && typeof v === "object") saved = v; } catch { /* use defaults */ }
  const out = { ...DEFAULT_WRITING };
  for (const k of KEYS) { const v = saved[k]; if (typeof v === "string" && v.trim()) out[k] = v.trim(); }
  return out;
}

const LIMITS: Record<keyof WritingSettings, [string, number]> = {
  senderName: ["Sender name", 60], company: ["Company", 80], location: ["Location", 80], offer: ["What you do", 200],
  dmPrompt: ["DM prompt", 4000], commentPrompt: ["Comment prompt", 2000],
};

export function writingFromForm(values: Record<string, string>): { writing: WritingSettings } | { error: { field: string; message: string } } {
  const writing = { ...DEFAULT_WRITING };
  for (const k of KEYS) {
    const v = (values[k] ?? "").trim();
    const [label, max] = LIMITS[k];
    if (v.length > max) return { error: { field: k, message: `${label} must be ${max} characters or fewer.` } };
    if (v) writing[k] = v;
  }
  if (!/\{link\}/.test(writing.dmPrompt)) return { error: { field: "dmPrompt", message: "The DM prompt must include {link} so message 2 carries your link." } };
  return { writing };
}

export function fillDmPrompt(text: string, w: WritingSettings, link: string): string {
  return text.replaceAll("{sender}", w.senderName).replaceAll("{company}", w.company).replaceAll("{location}", w.location).replaceAll("{offer}", w.offer).replaceAll("{link}", link);
}
