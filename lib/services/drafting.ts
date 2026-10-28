import type { Db } from "@/lib/db/core";
import type { AiEngine } from "@/lib/engine/types";
import { firstDmPrompt, followupPrompt, PORTFOLIO_LINK, systemPrompt } from "@/lib/engine/prompts";
import { parseWritingSettings } from "@/lib/domain/writing-settings";
import { checkDraft, parseParts } from "@/lib/engine/validate";
import { checkAgainstRecent } from "@/lib/domain/similarity";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { getLead } from "@/lib/db/repos/leads";
import { createOutgoing, listMessages, recentSentTexts } from "@/lib/db/repos/messages";
import { getSetting } from "@/lib/db/repos/settings";
import type { Campaign, Message } from "@/lib/db/types";
import { payerFor } from "@/lib/billing/attribution";
import type { MeteredAiCall } from "@/lib/engine/types";

const ATTEMPTS = 3;

/** Asks the AI, checks the answer against the hard rules and the similarity guard, retries with feedback. */
async function draft(engine: AiEngine, db: Db, kind: "dm" | "followup", prompt: string, leadId: number, jobId?: number): Promise<string[]> {
  const { lead } = context(db, leadId);
  const campaignId = lead.campaignId ?? undefined;
  const campaignPayer = campaignId ? payerFor(db, "campaign", campaignId) : null;
  const accountPayer = lead.accountId ? payerFor(db, "account", lead.accountId) : null;
  const payer = campaignPayer && accountPayer && campaignPayer === accountPayer ? campaignPayer : null;
  const link = getSetting(db, "portfolio_link") ?? PORTFOLIO_LINK;
  let feedback = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const metering: MeteredAiCall | undefined = payer && campaignId && lead.accountId ? {
      db, userId: payer, operationId: `ai:${jobId ?? `lead-${leadId}`}:${kind}:${attempt}`,
      source: { campaignId, accountId: lead.accountId, leadId, ...(jobId ? { jobId } : {}) }, maxOutputTokens: 1200,
    } : undefined;
    const raw = await engine.complete({ system: systemPrompt(parseWritingSettings(getSetting(db, "writing_settings"))), prompt: prompt + feedback, format: kind, metering });
    let problem: string | null = null;
    let parts: string[] = [];
    try {
      parts = parseParts(raw);
      problem = checkDraft(parts, kind, link);
      if (!problem) {
        const similar = checkAgainstRecent(parts.join(" "), recentSentTexts(db));
        if (similar.tooSimilar) problem = similar.reason;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : "Unreadable answer";
    }
    if (!problem) return parts;
    feedback = `\n\nYour last attempt was rejected: ${problem}. Fix that and answer again with JSON only.`;
  }
  throw new Error(`Could not get an acceptable ${kind} draft after ${ATTEMPTS} tries`);
}

function context(db: Db, leadId: number) {
  const lead = getLead(db, leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
  return { lead, campaign };
}
const fallbackCampaign: Pick<Campaign, "approvalRequired"> = { approvalRequired: true };

export async function draftFirstDm(db: Db, engine: AiEngine, leadId: number, profileNotes: string, actor = "worker", jobId?: number): Promise<Message> {
  const { lead, campaign } = context(db, leadId);
  const openings = recentSentTexts(db).map((t) => t.split(/\s+/).slice(0, 6).join(" "));
  const parts = await draft(engine, db, "dm", firstDmPrompt({
    handle: lead.handle, niche: lead.niche, followers: lead.followers, profileNotes,
    audienceText: campaign?.audienceText ?? "", recentOpenings: openings,
    portfolioLink: getSetting(db, "portfolio_link") ?? PORTFOLIO_LINK,
    writing: parseWritingSettings(getSetting(db, "writing_settings")),
  }), leadId, jobId);
  return createOutgoing(db, { leadId, accountId: lead.accountId, kind: "dm", parts, campaign: campaign ?? fallbackCampaign }, actor);
}

export async function draftFollowup(db: Db, engine: AiEngine, leadId: number, profileNotes = "", actor = "worker", jobId?: number): Promise<Message> {
  const { lead, campaign } = context(db, leadId);
  const previous = listMessages(db, { leadId, limit: 6 }).filter((m) => m.direction === "out" && m.status === "sent").map((m) => m.parts.join(" ")).join("\n---\n");
  const parts = await draft(engine, db, "followup", followupPrompt({ handle: lead.handle, previous, number: lead.followupsSent + 1, profileNotes }), leadId, jobId);
  return createOutgoing(db, { leadId, accountId: lead.accountId, kind: "followup", parts, campaign: campaign ?? fallbackCampaign }, actor);
}
