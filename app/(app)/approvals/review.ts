import type { Db } from "@/lib/db/core";
import { getMessage } from "@/lib/db/repos/messages";
import { getLead } from "@/lib/db/repos/leads";
import { campaignAccountIds, getCampaign } from "@/lib/db/repos/campaigns";
import { isDnc } from "@/lib/db/repos/dnc";
import { MAX_FOLLOWUPS } from "@/lib/services/outreach";
import { checkDraft, parseParts } from "@/lib/engine/validate";
import { decideApproval } from "@/lib/domain/approval";
import { checkAgainstRecent } from "@/lib/domain/similarity";

/** Re-read stored state inside the approval transaction and apply existing outreach rules. */
export function reviewDraft(db: Db, id: number, values: FormDataEntryValue[], bulk = false, recent: string[] = []): { parts: string[]; error?: never } | { error: string; parts?: never } {
  const message = getMessage(db, id);
  if (!message || message.status !== "pending_approval" || message.direction !== "out") return { error: "This draft is no longer waiting. Refresh this page." };
  if (message.kind === "reply" || message.kind === "incoming") return { error: "The app stops at the first reply. Reject this retired draft and hand the conversation to a person." };
  const lead = getLead(db, message.leadId);
  if (!lead || ["replied", "closed", "skipped"].includes(lead.stage) || isDnc(db, lead.handle)) return { error: "This lead has replied or outreach was stopped. This draft cannot be approved." };
  const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
  if (!campaign) return { error: "This draft has no campaign. Review the lead before approving." };
  if (campaign.status === "done") return { error: "This campaign is finished. Its drafts cannot be approved or sent." };
  if (message.accountId === null || !campaignAccountIds(db, campaign.id).includes(message.accountId)) return { error: "This draft’s sender is no longer assigned. Choose a sender in campaign settings before approving." };
  if (message.kind === "dm" && lead.stage !== "warmed") return { error: "First contact needs completed checks and warm-up, with no previous send. Refresh this lead before approving." };
  if (message.kind === "followup" && (lead.stage !== "dm_sent" || !campaign.followupsEnabled || lead.followupsSent >= MAX_FOLLOWUPS)) return { error: "This follow-up is no longer allowed. Check the lead’s stage and campaign follow-up settings." };
  let parts: string[];
  try { parts = parseParts(JSON.stringify({ parts: values.map(String) })); }
  catch { return { error: "Each message must contain 1 to 600 characters. Keep all parts of the draft." }; }
  const error = checkDraft(parts, message.kind);
  if (error) return { error };
  if (bulk) {
    const decision = decideApproval({ campaignApprovalRequired: campaign.approvalRequired, outgoing: parts.join(" "), similarityFlag: checkAgainstRecent(parts.join(" "), recent).tooSimilar });
    const individual = (reasons: string[]) => reasons.some(reason => reason !== "Campaign requires approval");
    if (individual(message.approvalReasons) || individual(decision.reasons)) return { error: "A selected draft needs individual review for sensitive topics or similar wording. Approve it separately." };
  }
  return { parts };
}
