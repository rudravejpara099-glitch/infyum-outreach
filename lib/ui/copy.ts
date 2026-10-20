import type { Stage } from "@/lib/domain/stages";

/** Presentation only. Stored stages, transitions and audit records stay unchanged. */
export const stageCopy: Record<Stage, { label: string; description: string }> = {
  found: { label: "New leads", description: "Added to the campaign and waiting to be checked." },
  qualified: { label: "Matches audience", description: "Passed the campaign’s audience checks." },
  warmed: { label: "Engaged with", description: "The campaign’s Instagram engagement step is complete." },
  dm_sent: { label: "Contacted", description: "The first message has been sent on Instagram." },
  replied: { label: "Replied", description: "Wrote back and has a conversation in your inbox." },
  call_offered: { label: "Invited to a call", description: "Received an invitation to book a call." },
  booked: { label: "Call booked", description: "A team member marked the call as booked." },
  closed: { label: "Finished", description: "The conversation has been marked as finished." },
  skipped: { label: "Not selected", description: "Not continuing in this campaign. Open the lead to see why." },
};

export function messageKindLabel(kind: string): string {
  return ({ dm: "First message", reply: "Reply", followup: "Follow-up", incoming: "Received" } as Record<string, string>)[kind] ?? "Message";
}
export function messageStatusLabel(status: string): string {
  return ({ draft: "Draft", pending_approval: "Needs your review", approved: "Waiting to send", sent: "Sent", failed: "Couldn’t send", rejected: "Not approved", received: "Received" } as Record<string, string>)[status] ?? "Status unavailable";
}
const events: Record<string, string> = {
  "job.error": "A task couldn’t finish",
  "lead.warmed_up": "Instagram engagement completed",
  "send.limit_reached": "Daily sending limit reached",
  "campaign.created": "Campaign created", "campaign.updated": "Campaign settings saved",
  "campaign.active": "Campaign started", "campaign.paused": "Campaign paused", "campaign.done": "Campaign finished",
  "leads.found": "Lead search completed", "lead.added": "Lead added",
  "message.sent.dm": "First message sent", "message.sent.reply": "Reply sent", "message.sent.followup": "Follow-up sent",
  "message.auto_reply_ignored": "Automatic reply ignored", "message.pending_approval": "Message ready for review",
  "message.approved": "Message waiting to send", "message.received": "Message received",
  "message.approved_by_human": "Message approved by a team member", "message.rejected": "Message not approved", "message.failed": "Message couldn’t be sent",
  "account.connected": "Instagram account added", "account.active": "Instagram account enabled", "account.paused": "Instagram account paused",
  "account.blocked": "Instagram account needs attention", "account.cap": "Daily message limit updated",
  "auth.login": "Signed in", "auth.setup": "Workspace account created", "team.added": "Teammate added",
  "dnc.added": "Added to the do not contact list", "dnc.removed": "Removed from the do not contact list",
  "settings.apify_cap": "Monthly search budget updated",
};
export function activityLabel(event: string): string {
  if (events[event]) return events[event];
  if (event.startsWith("lead.")) {
    const stage = event.slice(5);
    if (Object.hasOwn(stageCopy, stage)) return `Lead progress: ${stageCopy[stage as Stage].label}`;
  }
  return "Activity recorded";
}
export function actorLabel(actor: string): string {
  return ({ worker: "Automatic assistant", apify: "Lead search", system: "Outreach" } as Record<string, string>)[actor] ?? actor;
}
