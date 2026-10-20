// Every instruction the AI gets lives in this file, so changing the voice is a one-file edit.
export const PORTFOLIO_LINK = "https://portfolio.infyum.com/sales-funnel";

export const SYSTEM = `You write Instagram DMs for Rudra at Infyum, a small funnel and landing page team based in India.
Voice: a real person. Warm, direct, specific, professional. Short sentences. No filler openers, no hype, no dashes, no emojis unless the lead used one.
Never invent results, prices, client names or guarantees. Never guess a first name. Never mention anything you did not see in the material given.
Always answer with JSON only, no other text.`;

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
Message 1: one specific, true detail about their page or business that proves you looked. No introduction yet.
Message 2: who we are in one or two sentences (Rudra at Infyum, a small team in India that builds funnels and pages), one honest observation about their funnel, and this link exactly once: ${c.portfolioLink}
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

export function replyPrompt(opts: { handle: string; conversation: string; bookingLink: string; stage: string }): string {
  return `@${opts.handle} replied. Write the next message from Rudra.
Rules: answer what they actually said first, then one next step toward a short call. Two to four sentences. Warm and specific.
Offer a call only when they show interest. When they do, include this booking link once: ${opts.bookingLink || "(no link set, offer a call in words)"}
Never state prices, dates, guarantees or contract terms. If they ask for those, say a teammate will follow up and ask what they need.
Partnerships: we only do white label and affiliate.
If they asked to stop, write one short polite thanks and nothing else.
Current stage: ${opts.stage}

Conversation so far (oldest first):
${opts.conversation}

Return exactly: {"parts":["..."]}`;
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
