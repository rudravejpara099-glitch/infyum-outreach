"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { canMove, isStage } from "@/lib/domain/stages";
import { assignLead, getLead, moveStage, setNotes } from "@/lib/db/repos/leads";
import { afterSent, markDoNotContact } from "@/lib/services/outreach";
import { getMessage, returnFailedSendForReview } from "@/lib/db/repos/messages";
import { activeJobExists, enqueue, failedJobExists, failedSendError, resolveFailedSendJob } from "@/lib/db/repos/jobs";
import type { ActionResult } from "@/lib/ui/action-result";
import { isDnc } from "@/lib/db/repos/dnc";
import { campaignAccountIds, getCampaign } from "@/lib/db/repos/campaigns";
import { getAccount, leastLoadedAccount, listAccounts } from "@/lib/db/repos/accounts";
import { logActivity } from "@/lib/db/repos/activity";
import { createOutgoing, listMessages } from "@/lib/db/repos/messages";
import { getSetting } from "@/lib/db/repos/settings";
import { manualFirstDmError } from "@/lib/domain/manual-first-dm";
import { browserModeAllowsJob } from "@/lib/domain/browser-mode";
import { PORTFOLIO_LINK } from "@/lib/engine/prompts";
import { workerStatus } from "@/lib/queries/worker-status";
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
function refresh(id: number) { revalidatePath(`/leads/${id}`); revalidatePath("/pipeline"); revalidatePath("/"); }

export async function changeStage(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), to = String(form.get("to")), db = getDb();
  if (!validId(id) || !isStage(to)) return { error: "Choose a valid lead and stage." };
  const result: ActionResult = db.transaction(() => {
    const lead = getLead(db, id);
    if (!lead) return { error: "This lead could not be found. Refresh the page." };
    if (!canMove(lead.stage, to)) return { error: "This stage change is not available. Refresh the page to see the current options." };
    if (to === "found") {
      if (isDnc(db, lead.handle)) return { error: "This handle is on Do not contact. Checks cannot be restarted." };
      if (!lead.campaignId || !getCampaign(db, lead.campaignId)) return { error: "This lead needs a campaign before checks can restart." };
      const contacted = db.prepare("SELECT 1 FROM messages WHERE lead_id=? AND (direction='in' OR status='sent') UNION ALL SELECT 1 FROM activity WHERE lead_id=? AND action='lead.handoff' LIMIT 1").get(id, id);
      if (contacted) return { error: "Previously contacted leads cannot be restarted. Their conversation history stays intact." };
    }
    moveStage(db, id, to, user.email, String(form.get("note") ?? ""));
    return { message: to === "found" ? "Ready for fresh checks. They run when the campaign is active and the worker is running." : "Lead stage updated." };
  }).immediate();
  refresh(id); return result;
}
export async function saveNotes(form: FormData): Promise<ActionResult> {
  await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id) || !getLead(db, id)) return { error: "This lead could not be found. Refresh the page." };
  setNotes(db, id, String(form.get("notes") ?? ""));
  revalidatePath(`/leads/${id}`); return { message: "Notes saved." };
}

/** Reassigns a never-contacted lead without creating a second global lead record. */
export async function moveLeadToCampaign(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), targetId = Number(form.get("campaignId")), db = getDb();
  if (!validId(id) || !validId(targetId)) return { error: "Choose a valid lead and campaign." };
  let previousCampaignId: number | null = null;
  const result = db.transaction((): ActionResult => {
    const lead = getLead(db, id), target = getCampaign(db, targetId);
    if (!lead) return { error: "This lead could not be found. Refresh the page." };
    if (!target || target.status !== "active" || !target.approvalRequired) return { error: "Choose an active campaign with message approval turned on." };
    if (lead.campaignId === target.id) return { error: "This lead is already in that campaign." };
    if (lead.stage !== "found") return { error: "Only untouched leads can move. Finish or stop the current lead first." };
    if (isDnc(db, lead.handle)) return { error: "This handle is on Do not contact." };
    if (db.prepare("SELECT 1 FROM messages WHERE lead_id=? LIMIT 1").get(id)) return { error: "This lead has conversation history and cannot be moved." };
    if (db.prepare("SELECT 1 FROM jobs WHERE lead_id=? AND status IN ('queued','running') LIMIT 1").get(id)) return { error: "This lead has work in progress. Wait for it to finish before moving it." };
    const accounts = listAccounts(db), allowedIds = campaignAccountIds(db, target.id);
    const hasSender = accounts.some(account => allowedIds.includes(account.id) && account.status === "active" && browserModeAllowsJob(account.browserMode, "send"));
    if (!hasSender) return { error: "The campaign needs an active sending account before this lead can move." };
    previousCampaignId = lead.campaignId;
    const previousName = previousCampaignId ? getCampaign(db, previousCampaignId)?.name ?? "another campaign" : "unassigned leads";
    assignLead(db, id, target.id, null);
    logActivity(db, user.email, "lead.campaign_moved", { leadId: id, detail: `${previousName} → ${target.name}` });
    return { message: `Moved to ${target.name}. The campaign will run its usual lead checks before any message is prepared.` };
  }).immediate();
  if (!result.error) {
    if (previousCampaignId) revalidatePath(`/campaigns/${previousCampaignId}`);
    const lead = getLead(db, id);
    if (lead?.campaignId) revalidatePath(`/campaigns/${lead.campaignId}`);
    revalidatePath(`/leads/${id}`); revalidatePath("/pipeline"); revalidatePath("/"); revalidatePath("/activity");
  }
  return result;
}

/** Explicitly retries a failed read-only qualification check; it can never contact the lead. */
export async function retryQualification(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id)) return { error: "This lead could not be found. Refresh the page." };
  const result = db.transaction((): ActionResult => {
    const lead = getLead(db, id), campaign = lead?.campaignId ? getCampaign(db, lead.campaignId) : null;
    if (!lead || !campaign) return { error: "This lead needs a campaign before its check can run." };
    if (campaign.status !== "active") return { error: "Start the campaign before retrying this check." };
    if (lead.stage !== "found" || isDnc(db, lead.handle)) return { error: "This lead is not eligible for another profile check." };
    if (!failedJobExists(db, "qualify", id) || activeJobExists(db, "qualify", id)) return { error: "There is no failed check to retry. Refresh the page." };
    const accountIds = campaignAccountIds(db, campaign.id);
    const accountId = lead.accountId ?? leastLoadedAccount(db, accountIds);
    const account = accountId ? getAccount(db, accountId) : null;
    if (!account || !accountIds.includes(account.id) || account.status !== "active" || !browserModeAllowsJob(account.browserMode, "qualify")) {
      return { error: "Choose an active campaign account before retrying this check." };
    }
    enqueue(db, { type: "qualify", leadId: lead.id, accountId: account.id });
    logActivity(db, user.email, "job.retry_requested", { leadId: lead.id, accountId: account.id, detail: "Read-only lead check" });
    return { message: workerStatus(db, new Date()).running ? "Lead check retried. The background service will check the profile." : "Retry saved. This read-only check will wait until the background service is running." };
  }).immediate();
  if (!result.error) { revalidatePath(`/leads/${id}`); revalidatePath("/activity"); revalidatePath("/"); }
  return result;
}

/** Creates a human-written first DM in review without using a paid AI call. */
export async function createManualFirstDm(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id)) return { error: "This lead could not be found. Refresh the page." };
  const parts = [1, 2, 3].map((index) => String(form.get(`part${index}`) ?? "").trim());
  const portfolioLink = getSetting(db, "portfolio_link") ?? PORTFOLIO_LINK;
  const writingError = manualFirstDmError(parts, portfolioLink);
  if (writingError) return { error: writingError, field: "part1" };

  const result: ActionResult = db.transaction(() => {
    const lead = getLead(db, id), campaign = lead?.campaignId ? getCampaign(db, lead.campaignId) : null;
    if (!lead || !campaign) return { error: "This lead needs an active campaign before a message can be prepared." };
    if (campaign.status !== "active") return { error: "Start this campaign before preparing a message." };
    if (!campaign.approvalRequired) return { error: "Turn on message approval before creating a manual draft." };
    if (lead.stage !== "warmed") return { error: "Complete the lead checks and mark it ready for a first message first." };
    if (isDnc(db, lead.handle)) return { error: "This handle is on Do not contact." };
    if (listMessages(db, { leadId: lead.id, limit: 100 }).some((message) => message.direction === "out" && message.kind === "dm" && message.status !== "rejected")) {
      return { error: "A first message already exists for this lead. Review that message instead." };
    }
    const accountIds = campaignAccountIds(db, campaign.id);
    const accountId = lead.accountId ?? leastLoadedAccount(db, accountIds);
    const account = accountId ? getAccount(db, accountId) : null;
    if (!account || !accountIds.includes(account.id) || account.status !== "active" || !browserModeAllowsJob(account.browserMode, "send")) {
      return { error: "Choose an active campaign account that can send before preparing a message." };
    }
    if (!lead.accountId) assignLead(db, lead.id, campaign.id, account.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: account.id, kind: "dm", parts, campaign }, user.email);
    return message.status === "pending_approval"
      ? { message: "Draft created. Review and approve every part before it can be sent." }
      : { error: "This draft did not enter the approval queue. Check campaign approval settings." };
  }).immediate();
  refresh(id); revalidatePath("/approvals"); revalidatePath("/activity");
  return result;
}
export async function doNotContact(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id) || !getLead(db, id)) return { error: "This lead could not be found. Refresh the page." };
  const reason = String(form.get("reason") || "Asked to stop").trim();
  if (reason.length > 500) return { error: "Keep the reason under 500 characters.", field: "reason" };
  db.transaction(() => markDoNotContact(db, id, reason, user.email)).immediate();
  refresh(id); revalidatePath("/settings");
  return { message: "Outreach stopped. This handle is on Do not contact." };
}

/** Resolves a send whose outcome could not be confirmed. It never sends directly. */
export async function resolveUncertainSend(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), decision = String(form.get("decision"));
  if (!validId(id) || !["sent", "unsent"].includes(decision)) return { error: "Choose a valid message outcome." };
  if (form.get(decision === "sent" ? "confirmedSent" : "confirmedUnsent") !== "on") return { error: "Confirm the Instagram conversation check first." };
  const db = getDb();
  const result: ActionResult = db.transaction(() => {
    const message = getMessage(db, id), lead = message ? getLead(db, message.leadId) : null;
    const campaign = lead?.campaignId ? getCampaign(db, lead.campaignId) : null;
    const sendError = failedSendError(db, id), uncertain = /may have been sent/i.test(sendError ?? "");
    if (!message || !lead || !campaign || message.status !== "failed" || !sendError) return { error: "This message no longer needs an outcome check. Refresh the page." };
    if (decision === "sent" && !uncertain) return { error: "The app did not send this message. Return it for review instead." };
    if (decision === "sent") {
      afterSent(db, id, new Date(), user.email);
      resolveFailedSendJob(db, id);
      return { message: "Marked sent from your confirmation. The app will not send it again." };
    }
    if (campaign.status === "done") return { error: "This campaign is finished. The message cannot be queued again." };
    if (message.accountId === null || !campaignAccountIds(db, campaign.id).includes(message.accountId)) return { error: "Choose the original sending account in campaign settings before returning this to review." };
    if (isDnc(db, lead.handle)) return { error: "This handle is on Do not contact, so the message cannot be queued again." };
    returnFailedSendForReview(db, id, user.email);
    resolveFailedSendJob(db, id);
    return { message: "Returned to message review. Read every part and approve it before it can be queued again." };
  }).immediate();
  if (!result.error) {
    const message = getMessage(db, id)!;
    revalidatePath(`/leads/${message.leadId}`); revalidatePath("/approvals"); revalidatePath("/"); revalidatePath("/activity");
    const lead = getLead(db, message.leadId);
    if (lead?.campaignId) revalidatePath(`/campaigns/${lead.campaignId}`);
  }
  return result;
}
