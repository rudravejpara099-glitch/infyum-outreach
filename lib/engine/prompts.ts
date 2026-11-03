import { DEFAULT_WRITING, fillDmPrompt, type WritingSettings } from "@/lib/domain/writing-settings";

// Every instruction the AI gets lives in this file; the wording the owner can change lives in Settings.
export const PORTFOLIO_LINK = "https://portfolio.infyum.com/sales-funnel";

export function systemPrompt(w: WritingSettings = DEFAULT_WRITING): string {
  return `You write Instagram DMs for ${w.senderName} at ${w.company}, ${w.offer} based in ${w.location}.
Voice: a real person with a mood, humour and opinions, never a brand. Specific, direct, plain words the way people type on a phone. No filler openers, no hype, no dashes. Emojis are random: none, one or several, no pattern.
Never invent results, prices, client names or guarantees. Never guess a first name. Never mention anything you did not see in the material given.
Always answer with JSON only, no other text.`;
}
export const SYSTEM = systemPrompt();

/** Comments have their own plain-text contract; the DM JSON instruction must not override it. */
export const COMMENT_SYSTEM = `You write one natural Instagram comment about the supplied post, as a real person who actually looked at it.
Mention the actual subject of the post. Be specific and truthful. Never invent facts, prices or results. Length and emojis are up to you. No hashtags, links or dashes.
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
  return `Write the first contact for @${c.handle} as one to three separate messages, however many a real person would send.
${fillDmPrompt(c.writing?.dmPrompt ?? DEFAULT_WRITING.dmPrompt, w, c.portfolioLink)}

Who they are: ${c.niche || "unknown niche"}, ${c.followers ?? "unknown"} followers.
Audience we target: ${c.audienceText || "not specified"}
What we saw on their profile:
${c.profileNotes || "(nothing captured)"}

Recent openings to avoid repeating:
${c.recentOpenings.map((o) => `- ${o}`).join("\n") || "- none"}

Return exactly: {"parts":["..."]} with one to three strings.`;
}

export function followupPrompt(opts: { handle: string; previous: string; number: number; profileNotes: string }): string {
  return `@${opts.handle} did not reply to our first DMs. Write follow-up number ${opts.number} (max 2).
It must add something new: a specific observation or one useful point about their funnel. Never "just checking in", no guilt, no pressure, do not repeat earlier wording. Two to three sentences, no link.

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
