import type { Db } from "@/lib/db/core";
import { isAutoReply } from "@/lib/domain/autoreply";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { addDnc } from "@/lib/db/repos/dnc";
import { getLead, moveStage, scheduleFollowup } from "@/lib/db/repos/leads";
import { getMessage, markSent, recordIncoming } from "@/lib/db/repos/messages";
import { logActivity } from "@/lib/db/repos/activity";

export const FIRST_FOLLOWUP_DAYS = 2;
export const NEXT_FOLLOWUP_DAYS = 4;
export const MAX_FOLLOWUPS = 2;

const addDays = (days: number, from = new Date()) => new Date(from.getTime() + days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

/** Called by the worker right after Instagram confirms a message was sent. */
export function afterSent(db: Db, messageId: number, now = new Date()): void {
  const m = getMessage(db, messageId);
  if (!m) throw new Error(`Message ${messageId} not found`);
  markSent(db, messageId, now);
  const lead = getLead(db, m.leadId)!;
  const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
  logActivity(db, "worker", `message.sent.${m.kind}`, { leadId: lead.id, accountId: m.accountId });

  if (m.kind === "dm") {
    moveStage(db, lead.id, "dm_sent", "worker");
    if (campaign?.followupsEnabled) scheduleFollowup(db, lead.id, addDays(FIRST_FOLLOWUP_DAYS, now), 0);
  } else if (m.kind === "followup") {
    const sent = lead.followupsSent + 1;
    const more = campaign?.followupsEnabled && sent < MAX_FOLLOWUPS;
    scheduleFollowup(db, lead.id, more ? addDays(NEXT_FOLLOWUP_DAYS, now) : null, sent);
  }
}

/** Called by the worker when it reads a message from a lead. A real reply ends the app's job for that lead. */
export function handleIncoming(db: Db, leadId: number, text: string): { counted: boolean } {
  recordIncoming(db, leadId, null, text);
  if (isAutoReply(text)) {
    logActivity(db, "worker", "message.auto_reply_ignored", { leadId });
    return { counted: false };
  }
  const lead = getLead(db, leadId)!;
  // The first real message is the goal. Mark the hand-off, stop follow-ups, and leave the rest to a person or the GHL agent.
  if (lead.stage === "dm_sent" || lead.stage === "closed") moveStage(db, leadId, "replied", "worker");
  scheduleFollowup(db, leadId, null);
  logActivity(db, "worker", "lead.handoff", { leadId, accountId: lead.accountId, detail: text.slice(0, 200) });
  return { counted: true };
}

/** "Stop" means stop: close the lead and never contact the handle again. */
export function markDoNotContact(db: Db, leadId: number, reason: string, actor: string): void {
  const lead = getLead(db, leadId)!;
  addDnc(db, lead.handle, reason);
  scheduleFollowup(db, leadId, null);
  if (lead.stage !== "closed" && lead.stage !== "skipped") {
    try { moveStage(db, leadId, "closed", actor, reason); } catch { /* early stages cannot close; skip instead */ moveStage(db, leadId, "skipped", actor, reason); }
  }
}
