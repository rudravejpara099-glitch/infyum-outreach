import { STAGES, type Stage } from "@/lib/domain/stages";

/** UI wording only; the stored stage and activity codes stay unchanged. */
export const stageCopy: Record<Stage, { label: string; description: string }> = {
  found: { label: "New lead", description: "Waiting for the campaign checks." },
  qualified: { label: "Matches", description: "Passed the campaign’s audience checks." },
  warmed: { label: "Engaged", description: "The Instagram engagement step is complete." },
  dm_sent: { label: "Contacted", description: "The first message was sent." },
  replied: { label: "Replied", description: "A person wrote back; your team takes over from here." },
  closed: { label: "Stopped", description: "No more messages will be sent." },
  skipped: { label: "Not selected", description: "This lead will not continue in the campaign." },
};

export const navigationCopy = {
  "/": "Overview",
  "/campaigns": "Campaigns",
  "/pipeline": "Lead progress",
  "/approvals": "Review messages",
  "/inbox": "Replies",
  "/accounts": "Accounts",
  "/activity": "History",
  "/settings": "Settings",
} as const;

export function messageKindLabel(kind: string): string {
  return ({ dm: "First message", followup: "Follow-up", incoming: "Received" } as Record<string, string>)[kind] ?? "Message";
}

export function messageStatusLabel(status: string): string {
  return ({
    draft: "Draft",
    pending_approval: "Needs review",
    approved: "Queued",
    sent: "Sent",
    failed: "Could not send",
    rejected: "Not approved",
  } as Record<string, string>)[status] ?? "Status unavailable";
}

const activityCopy: Record<string, string> = {
  "job.error": "A task couldn’t finish",
  "lead.warmed_up": "Instagram engagement completed",
  "lead.handoff": "Lead replied; conversation handed over",
  "send.limit_reached": "Daily message limit reached",
  "campaign.created": "Campaign created",
  "campaign.updated": "Campaign settings saved",
  "campaign.active": "Campaign started",
  "campaign.paused": "Campaign paused",
  "campaign.done": "Campaign finished",
  "leads.found": "Lead search completed",
  "lead.added": "Lead added",
  "message.sent.dm": "First message sent",
  "message.sent.followup": "Follow-up sent",
  "message.auto_reply_ignored": "Automatic reply ignored",
  "message.pending_approval": "Message ready for review",
  "message.approved": "Message approved and queued",
  "message.received": "Message received",
  "message.approved_by_human": "Message approved by a team member",
  "message.rejected": "Message not approved",
  "message.failed": "Message couldn’t be sent",
  "account.connected": "Instagram account added",
  "account.active": "Instagram account enabled",
  "account.paused": "Instagram account paused",
  "account.blocked": "Instagram account needs attention",
  "account.cap": "Daily message limit updated",
  "auth.login": "Signed in",
  "auth.setup": "Workspace account created",
  "team.added": "Teammate added",
  "dnc.added": "Added to the do not contact list",
  "dnc.removed": "Removed from the do not contact list",
  "settings.apify_cap": "Monthly lead-search limit updated",
  "settings.team_timezone": "Team time zone updated",
};

export function activityLabel(action: string): string {
  const known = activityCopy[action];
  if (known) return known;
  if (action.startsWith("lead.")) {
    const stage = action.slice("lead.".length);
    if ((STAGES as readonly string[]).includes(stage)) return `Lead progress: ${stageCopy[stage as Stage].label}`;
  }
  if (action.startsWith("pace.")) return "Work break scheduled";
  return "Activity recorded";
}

export function actorLabel(actor: string): string {
  return ({ worker: "Outreach assistant", apify: "Lead search" } as Record<string, string>)[actor] ?? actor;
}

export function loginWindowHint(workerRunning: boolean): string {
  return workerRunning ? "Outreach is opening the sign-in window." : "It will open after Outreach’s background service starts on this computer.";
}

const jobCopy: Record<string, string> = {
  find_leads: "Search for leads",
  open_login: "Open Instagram sign-in",
  qualify: "Check a lead",
  warmup: "Engage with a lead",
  draft_dm: "Write a first message",
  draft_followup: "Write a follow-up",
  draft_reply: "Older reply task",
  send: "Send a message",
  check_inbox: "Check Instagram replies",
};

export function jobTypeLabel(type: string): string {
  return jobCopy[type] ?? "Background task";
}

export function jobErrorLabel(type: string, error: string): string {
  if (type === "open_login" && /replaced by the owner signed-in Chrome/i.test(error)) {
    return "Your existing Chrome session replaced the Instagram sign-in window.";
  }
  return error;
}
