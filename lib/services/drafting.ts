import type { Db } from "@/lib/db/core";
import type { AiEngine } from "@/lib/engine/types";
import { firstDmPrompt, followupPrompt, PORTFOLIO_LINK, systemPrompt } from "@/lib/engine/prompts";
import { parseWritingSettings } from "@/lib/domain/writing-settings";
import { checkDraft, parseDmResult, parseParts } from "@/lib/engine/validate";
import { checkAgainstRecent } from "@/lib/domain/similarity";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { getLead, moveStage } from "@/lib/db/repos/leads";
import { listActivity, logActivity } from "@/lib/db/repos/activity";
import { createOutgoing, listMessages, recentSentTexts } from "@/lib/db/repos/messages";
import { getSetting } from "@/lib/db/repos/settings";
import type { Campaign, Message } from "@/lib/db/types";
import { payerFor } from "@/lib/billing/attribution";
import type { MeteredAiCall } from "@/lib/engine/types";

const ATTEMPTS = 3;

/** Asks the AI, checks the answer against the hard rules and the similarity guard, retries with feedback. */
type Drafted = { skip: true; reason: string } | { skip: false; parts: string[]; profile: string; why: string; flags: string; followup: string };
async function draft(engine: AiEngine, db: Db, kind: "dm" | "followup", prompt: string, leadId: number, jobId?: number, notes = ""): Promise<Drafted> {
  const { lead } = context(db, leadId);
  const campaignId = lead.campaignId ?? undefined;
  const campaignPayer = campaignId ? payerFor(db, "campaign", campaignId) : null;
  const accountPayer = lead.accountId ? payerFor(db, "account", lead.accountId) : null;
  const payer = campaignPayer && accountPayer && campaignPayer === accountPayer ? campaignPayer : null;
  let feedback = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const metering: MeteredAiCall | undefined = payer && campaignId && lead.accountId ? {
      db, userId: payer, operationId: `ai:${jobId ?? `lead-${leadId}`}:${kind}:${attempt}`,
      source: { campaignId, accountId: lead.accountId, leadId, ...(jobId ? { jobId } : {}) }, maxOutputTokens: 1200,
    } : undefined;
    const raw = await engine.complete({ system: systemPrompt(parseWritingSettings(getSetting(db, "writing_settings"))), prompt: prompt + feedback, format: kind, metering });
    let problem: string | null = null;
    let parts: string[] = [];
    let profile = "", why = "", flags = "", followup = "", teachesMarketing = false;
    try {
      if (kind === "dm") {
        const result = parseDmResult(raw);
        if (result.skip) return result;
        ({ parts, profile, why, flags, followup, teachesMarketing } = result);
      } else parts = parseParts(raw);
      problem = checkDraft(parts, kind, { notes, teachesMarketing });
      if (!problem) {
        const similar = checkAgainstRecent(parts.join(" "), recentSentTexts(db));
        if (similar.tooSimilar) problem = similar.reason;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : "Unreadable answer";
    }
    if (!problem) return { skip: false, parts, profile, why, flags, followup };
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

/** Returns the draft in review, or null when the writer judged the lead not a fit (the lead is then Skipped with its reason). */
export async function draftFirstDm(db: Db, engine: AiEngine, leadId: number, profileNotes: string, actor = "worker", jobId?: number): Promise<Message | null> {
  const { lead, campaign } = context(db, leadId);
  const openings = recentSentTexts(db).map((t) => t.split(/\s+/).slice(0, 6).join(" "));
  const result = await draft(engine, db, "dm", firstDmPrompt({
    handle: lead.handle, niche: lead.niche, followers: lead.followers, profileNotes,
    audienceText: campaign?.audienceText ?? "", recentOpenings: openings,
    portfolioLink: getSetting(db, "portfolio_link") ?? PORTFOLIO_LINK,
    writing: parseWritingSettings(getSetting(db, "writing_settings")),
  }), leadId, jobId, profileNotes);
  if (result.skip) {
    db.transaction(() => {
      moveStage(db, leadId, "skipped", actor, result.reason);
      logActivity(db, actor, "dm.skipped", { leadId, accountId: lead.accountId, detail: result.reason });
    }).immediate();
    return null;
  }
  const message = createOutgoing(db, { leadId, accountId: lead.accountId, kind: "dm", parts: result.parts, campaign: campaign ?? fallbackCampaign }, actor);
  const notes = [result.profile && `Profile: ${result.profile}`, result.why && `Why this angle: ${result.why}`, result.flags && `Flags: ${result.flags}`].filter(Boolean).join(" | ");
  if (notes) logActivity(db, actor, "dm.drafted", { leadId, accountId: lead.accountId, detail: notes.slice(0, 1500) });
  // The follow-up is written with the first DM, from the same profile. It is used later when the lead has not replied.
  if (result.followup && !checkDraft([result.followup], "followup")) logActivity(db, actor, "dm.followup_draft", { leadId, accountId: lead.accountId, detail: result.followup });
  return message;
}

export async function draftFollowup(db: Db, engine: AiEngine, leadId: number, profileNotes = "", actor = "worker", jobId?: number): Promise<Message> {
  const { lead, campaign } = context(db, leadId);
  if (lead.followupsSent === 0) {
    const prepared = listActivity(db, { leadId, limit: 200 }).find((a) => a.action === "dm.followup_draft" && typeof a.detail === "string" && !checkDraft([a.detail], "followup"));
    if (prepared) return createOutgoing(db, { leadId, accountId: lead.accountId, kind: "followup", parts: [String(prepared.detail)], campaign: campaign ?? fallbackCampaign }, actor);
  }
  const previous = listMessages(db, { leadId, limit: 6 }).filter((m) => m.direction === "out" && m.status === "sent").map((m) => m.parts.join(" ")).join("\n---\n");
  const result = await draft(engine, db, "followup", followupPrompt({ handle: lead.handle, previous, number: lead.followupsSent + 1, profileNotes }), leadId, jobId);
  if (result.skip) throw new Error("Unexpected skip on a follow-up");
  return createOutgoing(db, { leadId, accountId: lead.accountId, kind: "followup", parts: result.parts, campaign: campaign ?? fallbackCampaign }, actor);
}
