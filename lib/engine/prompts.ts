import { DEFAULT_WRITING, fillDmPrompt, type WritingSettings } from "@/lib/domain/writing-settings";

// Every instruction the AI gets lives in this file; the wording the owner can change lives in Settings.
export const PORTFOLIO_LINK = "https://portfolio.infyum.com/sales-funnel";

export function systemPrompt(w: WritingSettings = DEFAULT_WRITING): string {
  return `You write Instagram DMs for ${w.senderName} at ${w.company}, to US-based coaches and consultants.
Voice: a real person. Casual, friendly, direct, specific. Short sentences. No filler openers, no hype, no dashes, no hashtags. Emojis are optional and vary from one DM to the next.
Never invent results, numbers, client stories, prices or guarantees. Never guess a first name. Never mention anything you did not see in the material given.
Always answer with JSON only, no other text.`;
}
export const SYSTEM = systemPrompt();

/** Comments have their own plain-text contract; the DM JSON instruction must not override it. */
export const COMMENT_SYSTEM = `You write one natural Instagram comment about the supplied post.
Aim for five written words, followed by one relevant emoji. The allowed range is 3 to 8 words and 1 to 3 emojis; emojis do not count as words. Mention the actual subject of the post. Be warm, specific and truthful. Never invent facts, prices or results.
Answer with only the comment text, without JSON, quotes, labels or an explanation.`;

export type DraftContext = {
  handle: string;
  niche: string;
  followers: number | null;
  profileNotes: string;      // bio, highlights, recent post captions, what the bio link leads to
  audienceText: string;
  recentOpenings: string[];  // first words of recent DMs, to avoid
  portfolioLink: string;
  writing?: WritingSettings;
};

export function firstDmPrompt(c: DraftContext): string {
  const w = c.writing ?? DEFAULT_WRITING;
  return `Write the first DM for @${c.handle}.
${fillDmPrompt(c.writing?.dmPrompt ?? DEFAULT_WRITING.dmPrompt, w, c.portfolioLink)}

Who they are: ${c.niche || "unknown niche"}, ${c.followers ?? "unknown"} followers.
Audience we target: ${c.audienceText || "not specified"}
What we saw on their profile (including what their bio link leads to, when captured):
${c.profileNotes || "(nothing captured)"}

Recent openings to avoid repeating:
${c.recentOpenings.map((o) => `- ${o}`).join("\n") || "- none"}

If they are a fit return exactly: {"skip":false,"why":"two to four short lines on what you noticed and the gap you chose","parts":["the DM, ready to send"],"flags":"only when needed, else empty string"}
If they are not a fit return exactly: {"skip":true,"reason":"one line"}`;
}

export function followupPrompt(opts: { handle: string; previous: string; number: number; profileNotes: string }): string {
  return `@${opts.handle} did not reply to our first DM. Write follow-up number ${opts.number} (max 2), sent 3 to 4 days later.
It must add something new, such as a fresh idea or a different angle. Never "just following up", "just checking in", no guilt, no pressure, and do not repeat earlier wording. Make it shorter and lower-pressure than the first DM, two to three sentences, no link. Do not end it with the same Loom line as other follow-ups; vary how you offer to show something.

What we sent before:
${opts.previous}

What we know about them:
${opts.profileNotes || "(nothing captured)"}

Return exactly: {"parts":["..."]}`;
}

export function commentPrompt(postContext: string, alreadyUsed: string[] = [], instructions: string = DEFAULT_WRITING.commentPrompt): string {
  const avoid = alreadyUsed.length ? `\n\nComments already posted on this person's other posts, never reuse their wording or opening:\n${alreadyUsed.map((c) => `- ${c}`).join("\n")}` : "";
  return `${instructions}${avoid}

Post: ${postContext}`;
}
