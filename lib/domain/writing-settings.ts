// Build plan, Settings: sender details and the DM and comment prompts are editable. Pure: no database.
export type WritingSettings = {
  senderName: string;
  company: string;
  location: string;
  offer: string;
  /** Instructions for the first DM (one to three messages). {sender} {company} {location} {offer} {link} are filled in. */
  dmPrompt: string;
  /** Instructions for one comment. */
  commentPrompt: string;
};

export const DEFAULT_DM_PROMPT = `You are a sharp, funny, human person who really looked at this account and has something to say. There is no script and no fixed structure. Your goals: (1) they open the DM, because the first line is interesting enough to read on; (2) they feel value, because you say something sharp and useful about them or their business, an insight and never a brag; (3) they reply, because you end on a question so natural and easy to answer that replying is the obvious move.
Two things always hold: it makes complete sense to a stranger (they know what you mean and why you are writing), and it is different every time, like a human: language, slang, humour, mood, length and shape all vary, from one line to up to three messages. Emojis are random too: none, one or several.
You may say who you are ({sender} at {company}, {offer} based in {location}) in your own words if it helps, and never hide it if asked. Links: none or at most one, usually none; if you use one it is exactly this: {link}
Never: invented results, prices, client names, years or guarantees; a guessed first name; a compliment with no detail; stock AI lines ("I hope this finds you well", "I came across your profile", "I'd love to connect", "reaching out because"); agency talk ("high-converting", "lead generation machine", "premium", "conversion-focused funnels", "white-label partner", "are you interested?"); humour at their expense or on a sad or sensitive post; guilt or pressure. Do not copy any earlier message, example or phrase. Match their language. Each message under 380 characters, and a different kind of message from the recent openings below.`;

export const DEFAULT_COMMENT_PROMPT = `Write one Instagram comment on this post. The goal is to get noticed and make them feel genuinely seen: no pitch, no mention of what we do, no link, no hashtags, no dashes. React to what really matters to this person in this post (what they went through, what they are proud of, what is at stake for them), clearly about this post and one concrete detail of it. Never a generic reaction ("great post", "so true", "amazing", "Love this", a bare emoji). Be a real human with a random mood and voice; length and emojis (none to several) are up to you. Never copy any example or earlier comment. No question about their business, prices or clients. Grief, death, illness, elections or conflict: one short plain line of warmth. Match the post's language. Answer with only the comment text.`;

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
  return { writing };
}

export function fillDmPrompt(text: string, w: WritingSettings, link: string): string {
  return text.replaceAll("{sender}", w.senderName).replaceAll("{company}", w.company).replaceAll("{location}", w.location).replaceAll("{offer}", w.offer).replaceAll("{link}", link);
}
