// Every instruction the AI gets lives in this file, so changing the voice is a one-file edit.
export const PORTFOLIO_LINK = "https://portfolio.infyum.com/sales-funnel";

export const SYSTEM = `You write Instagram DMs for Rudra at Infyum, a small funnel and landing page team based in India.
Voice: a real person. Warm, direct, specific, professional. Short sentences. No filler openers, no hype, no dashes, no emojis unless the lead used one.
Never invent results, prices, client names or guarantees. Never guess a first name. Never mention anything you did not see in the material given.
Always answer with JSON only, no other text.`;

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
};

export function firstDmPrompt(c: DraftContext): string {
  return `Write the first contact for @${c.handle} as THREE separate messages.
Message 1: speak directly to the recipient using "you" or "your" and mention one specific, true detail about their page or business that proves you looked. No introduction yet.
Message 2: introduce yourself by name as Rudra at Infyum, a small team based in India that builds funnels and landing pages. You MUST include all three names: Rudra, Infyum, India. Add one honest observation about their funnel and this link exactly once: ${c.portfolioLink}
Message 3: one curious question about their funnel or business. Nothing else.
Rules: each message under 380 characters. Different wording and shape from the recent openings below. Match their language if their audience is not English. No other links.

Who they are: ${c.niche || "unknown niche"}, ${c.followers ?? "unknown"} followers.
Audience we target: ${c.audienceText || "not specified"}
What we saw on their profile:
${c.profileNotes || "(nothing captured)"}

Recent openings to avoid repeating:
${c.recentOpenings.map((o) => `- ${o}`).join("\n") || "- none"}

Return exactly: {"parts":["...","...","..."]}`;
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

export function commentPrompt(postContext: string, alreadyUsed: string[] = []): string {
  const avoid = alreadyUsed.length ? `\n\nComments already posted on this person's other posts, never reuse their wording or opening:\n${alreadyUsed.map((c) => `- ${c}`).join("\n")}` : "";
  return `Write one short Instagram comment on this post. 3 to 8 words, 1 to 3 emojis, specific to the post, warm, no dashes, no hashtags, no questions about business. Never start with "Love this", "Great" or "Nice". Name one concrete detail from the post's own text. Answer with only the comment text.${avoid}

Post: ${postContext}`;
}
