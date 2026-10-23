import { parseDb } from "@/lib/format";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import type { QueuedWork } from "@/lib/queries/worker-status";

const labels: Record<string, string> = {
  check_inbox: "reply check",
  qualify: "lead check",
  warmup: "lead preparation",
  draft_dm: "message draft",
  draft_followup: "follow-up draft",
  find_leads: "lead search",
  send: "approved message",
};

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Plain status copy makes pacing waits visible without implying work is happening now. */
export function runningWorkerCopy(job: QueuedWork | null, now: Date, timeZone: string): string {
  if (!job) return "Outreach is running and will handle campaign tasks when they are due. Approvals and account limits still apply.";
  const at = parseDb(job.runAfter);
  if (at.getTime() <= now.getTime()) return "Outreach is working through campaign tasks. Approvals and account limits still apply.";

  const today = dateInTimeZone(now, timeZone);
  const dueDay = dateInTimeZone(at, timeZone);
  const day = dueDay === today ? "" : dueDay === nextDay(today) ? " tomorrow" : ` on ${dueDay}`;
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  const task = labels[job.type] ?? "campaign task";
  return `Next ${task}${day} at ${time} (team time). Approvals and account limits still apply.`;
}

/** Separate stale sign-in-window failures from campaign work that needs review. */
export function failedWorkCopy(failedByType: Record<string, number>): string | null {
  const total = Object.values(failedByType).reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const signIns = failedByType.open_login ?? 0;
  if (signIns === total) return `${signIns} sign-in attempts did not finish. Check Accounts if you still need to open a sign-in window.`;
  return `${total} background tasks need attention. View activity for details.`;
}

/** Explain the manual fallback when independently metered automatic writing is off. */
export function automaticWritingCopy(configured: boolean): string | null {
  if (configured) return null;
  return "Claude does not need to be installed. Automatic message drafts need a separately billed AI connection, which is off. You can still check replies and write a message yourself for a warmed lead.";
}
