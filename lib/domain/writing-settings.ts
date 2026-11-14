// Build plan, Settings: sender details and the DM and comment prompts are editable. Pure: no database.
export type WritingSettings = {
  senderName: string;
  company: string;
  location: string;
  offer: string;
  /** Instructions for the first DM (INFYUM DM Agent Guidelines). {sender} {company} {location} {offer} {link} are filled in. */
  dmPrompt: string;
  /** Instructions for one comment. */
  commentPrompt: string;
};

export const DEFAULT_DM_PROMPT = `Write ONE first Instagram DM from {sender} at {company} to this prospect, using the guidelines below. The prospect does not know us, so the DM must earn a reply by showing we really looked at their account. The goal is a reply that opens a conversation, not a sale inside the DM.

What {company} does (never describe it this way in the DM): funnels, landing pages, lead capture and automated follow-up, so a business scales, stops relying on manual follow-up and depends less on the founder. Coaches and consultants think in their own problems ("my calendar isn't full", "leads ghost me", "I'm stuck doing follow-ups myself"). Name their problem in their words and say what would change for them. Mention funnels or automation only lightly, in plain terms.
Sender: {sender}. Sign off with the name and {company}, and vary the format ("{sender} | {company}", "{sender}, {company}" or just "{sender}"). Offer: {offer}. Offer it softly as a question ("Want me to show you?"). Tone: casual and friendly, one business owner to another.

Who we target: US-based coaches and consultants only. Assume US unless the profile clearly shows otherwise; if location is unclear, write the DM and put "location unconfirmed, assumed US" in flags.
SKIP (no DM) when: the profile is clearly outside the US; it is not a coach or consultant business or has no offer we can improve (a personal account, or a creator or public figure with no coaching or consulting offer); or the business is clearly winding down.

Analyze first: bio (what they sell, to whom), the link in bio and the page it leads to (freebies, booking pages, offers, waitlists), recent posts (offers, events, launches, "comment X" or "DM X" calls to action), size and location signals. Find the ONE real gap: where does interest from a post or freebie have nowhere useful to go? Pick one specific recent detail to mention so it is clear you looked.
Choose the angle that matches what is actually weak, using the full range, not only follow-up: a freebie that leads nowhere (the funnel behind it); a busy link in bio or plain list of links (a clearer landing page); a link straight to a call (a lower-pressure step before the call); a webinar, challenge, event or launch with no path afterwards (an event or launch funnel); high engagement with no lead capture (comment-to-DM capture); several offers with no path between them (a guided path); leads with no nurturing (follow-up automation, only if that is the real gap); a founder doing everything by hand (a business that runs without them). Do not default to follow-up.

Write the DM:
- No template and no repeated pattern. Change the opening, structure, length, sign-off, emoji use and way of describing the offer every time. It can open with an observation, a single line and a question, or a short insight with no question. Match their voice (blunt, warm, faith-based, playful, professional).
- One specific detail from their account. Say what you noticed in plain words, then ask one easy question about their business or offer to show something. Describe what would change for them, not how a funnel or automation works.
- About 50 to 90 words (a little longer is fine when the detail earns it), easy to read on a phone, in short paragraphs. No links.
- Never reuse an opener, a compliment-then-question shape or a sign-off from the recent openings below.
If they teach marketing or sales: never explain marketing to them and never pitch a funnel build for their own business. Stay humble and curious: ask a genuine question about one specific thing in their business, or suggest a partnership (their community learns the strategy but still needs someone to build the pages and sequences, and {company} can be that team). No sales-pitch tone.
Follow-up: write it together with the DM, only when it adds something new (a fresh idea or a different angle, never "just following up"). Shorter and lower-pressure than the DM, and do not end every follow-up with the same Loom line.
Honesty: never invent results, numbers, client stories or case studies; make no proof claims. Only state what you actually saw. If data is thin (for example no posts visible), say so in flags and keep the DM to what you saw.`;

export const DEFAULT_COMMENT_PROMPT = `Write one short Instagram comment on this post. Use only 4 to 6 words (never more than 8), then 1 to 2 emojis. Specific to the post, warm, no dashes, no hashtags, no questions about business. Never start with "Love this", "Great" or "Nice". Name one concrete detail from the post's own text. Length example only, never reuse its words: "That checklist idea is smart 🙌". Answer with only the comment text.`;

export const DEFAULT_WRITING: WritingSettings = {
  senderName: "Sunil",
  company: "INFYUM",
  location: "India",
  offer: "a free 2-minute Loom audit of their funnel or page, or a free idea for what to improve or automate (pick whichever fits the prospect)",
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
  // A DM prompt saved under the old three-message contract (it had to contain {link}) must not override the current guidelines.
  if (/\{link\}/.test(out.dmPrompt)) out.dmPrompt = DEFAULT_DM_PROMPT;
  return out;
}

const LIMITS: Record<keyof WritingSettings, [string, number]> = {
  senderName: ["Sender name", 60], company: ["Company", 80], location: ["Location", 80], offer: ["What you do", 200],
  dmPrompt: ["DM prompt", 8000], commentPrompt: ["Comment prompt", 2000],
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
