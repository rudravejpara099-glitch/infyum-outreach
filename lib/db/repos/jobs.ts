import type { Db } from "../core";
import type { Job } from "../types";
import { getMessage, markFailed } from "./messages";
import { mayRecoverAfterCrash } from "@/lib/domain/job-recovery";

const MAX_ATTEMPTS = 3;

const map = (r: Record<string, unknown>): Job => ({
  id: r.id as number, type: r.type as string, leadId: r.lead_id as number | null, accountId: r.account_id as number | null,
  payload: JSON.parse(r.payload as string) as Record<string, unknown>, status: r.status as Job["status"],
  runAfter: r.run_after as string, attempts: r.attempts as number, lastError: r.last_error as string,
});

export function enqueue(db: Db, job: { type: string; leadId?: number | null; accountId?: number | null; payload?: Record<string, unknown>; runAfter?: string }): number {
  const info = db.prepare("INSERT INTO jobs (type, lead_id, account_id, payload, run_after) VALUES (?,?,?,?,COALESCE(?, datetime('now')))")
    .run(job.type, job.leadId ?? null, job.accountId ?? null, JSON.stringify(job.payload ?? {}), job.runAfter ?? null);
  return Number(info.lastInsertRowid);
}

/** A lane is one Instagram account (or the shared lane for jobs that use no account). Jobs in a lane run one at a time. */
export type Lane = { accountId: number | null };

/** Takes the oldest due job, optionally only from one lane. The transaction makes it safe even if two workers ever ran. */
export function claimNext(db: Db, types?: string[], lane?: Lane, mayClaim?: () => boolean): Job | null {
  return db.transaction(() => {
    if (mayClaim && !mayClaim()) return null;
    const where = ["status='queued'", "run_after <= datetime('now')"];
    const args: unknown[] = [];
    if (types?.length) { where.push(`type IN (${types.map(() => "?").join(",")})`); args.push(...types); }
    if (lane) {
      if (lane.accountId === null) where.push("account_id IS NULL");
      else { where.push("account_id = ?"); args.push(lane.accountId); }
    }
    // Check for a first reply before processing a waiting send in the same account lane.
    const r = db.prepare(`SELECT * FROM jobs WHERE ${where.join(" AND ")} ORDER BY CASE WHEN type='check_inbox' THEN 0 ELSE 1 END, run_after, id LIMIT 1`).get(...args) as Record<string, unknown> | undefined;
    if (!r) return null;
    db.prepare("UPDATE jobs SET status='running', attempts = attempts + 1 WHERE id = ?").run(r.id);
    return map({ ...r, status: "running", attempts: (r.attempts as number) + 1 });
  })();
}
export function completeJob(db: Db, id: number): void {
  db.prepare("UPDATE jobs SET status='done' WHERE id = ?").run(id);
}
/** Retries up to three times with growing delays, then gives up and keeps the error. */
export function failJob(db: Db, job: Job, error: string): void {
  if (job.attempts >= MAX_ATTEMPTS) {
    db.prepare("UPDATE jobs SET status='failed', last_error=? WHERE id=?").run(error, job.id);
  } else {
    db.prepare("UPDATE jobs SET status='queued', last_error=?, run_after=datetime('now', ?) WHERE id=?")
      .run(error, `+${job.attempts * 10} minutes`, job.id);
  }
}
/** Stops automatic retries when a send may already have reached Instagram. */
export function failJobPermanently(db: Db, id: number, error: string): void {
  db.prepare("UPDATE jobs SET status='failed', last_error=? WHERE id=?").run(error, id);
}
export function listJobs(db: Db, limit = 100): Job[] {
  return (db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(map);
}
export function failedSendError(db: Db, messageId: number): string | null {
  const row = db.prepare(`SELECT last_error FROM jobs WHERE type='send' AND status='failed'
    AND json_extract(payload,'$.messageId')=? ORDER BY id DESC LIMIT 1`).get(messageId) as { last_error: string } | undefined;
  return row?.last_error ?? null;
}
export function resolveFailedSendJob(db: Db, messageId: number): void {
  db.prepare(`UPDATE jobs SET status='done',last_error='' WHERE type='send' AND status='failed'
    AND json_extract(payload,'$.messageId')=?`).run(messageId);
}
/** Recover only idempotent reads; hold interrupted writes and paid jobs for human review. */
export function requeueStuck(db: Db): number {
  return db.transaction(() => {
    const stuck = db.prepare("SELECT id,type,payload FROM jobs WHERE status='running'").all() as { id: number; type: string; payload: string }[];
    const requeue = db.prepare("UPDATE jobs SET status='queued' WHERE id=?");
    for (const job of stuck) {
      if (job.type !== "send" && mayRecoverAfterCrash(job.type)) { requeue.run(job.id); continue; }
      if (job.type !== "send") {
        const reason = job.type === "open_login"
          ? "The sign-in window task was interrupted. Check Accounts before requesting another window."
          : "Paused after interruption. This task may already have changed Instagram or used a paid provider. Review it before trying again.";
        db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=?")
          .run(reason, job.id);
        continue;
      }
      let messageId = 0;
      try { messageId = Number((JSON.parse(job.payload) as { messageId?: unknown }).messageId); } catch { /* malformed send payloads are still held for review */ }
      const message = Number.isSafeInteger(messageId) && messageId > 0 ? getMessage(db, messageId) : undefined;
      if (message?.status === "approved") {
        const reason = "A message may have been sent before the background service stopped. Check Instagram before trying again.";
        markFailed(db, messageId, reason);
        failJobPermanently(db, job.id, reason);
      } else if (message?.status === "sent" || message?.status === "failed" || message?.status === "rejected") {
        db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(job.id);
      } else {
        failJobPermanently(db, job.id, "The background service stopped during a message send. Check this task before trying again.");
      }
    }
    return stuck.length;
  })();
}

/** True when the same kind of job for the same lead (and account, when given) is already waiting or running. */
export function activeJobExists(db: Db, type: string, leadId: number | null, accountId?: number | null): boolean {
  const byAccount = accountId === undefined ? "" : "AND COALESCE(account_id,0) = COALESCE(?,0)";
  const args: unknown[] = [type, leadId];
  if (accountId !== undefined) args.push(accountId);
  return !!db.prepare(
    `SELECT 1 FROM jobs WHERE type = ? AND status IN ('queued','running') AND COALESCE(lead_id,0) = COALESCE(?,0) ${byAccount} LIMIT 1`,
  ).get(...args);
}

/** A terminal failed task is not silently recreated by the planner on every pass. */
export function failedJobExists(db: Db, type: string, leadId: number | null): boolean {
  return !!db.prepare("SELECT 1 FROM jobs WHERE type=? AND status='failed' AND COALESCE(lead_id,0)=COALESCE(?,0) LIMIT 1").get(type, leadId);
}

/** Try again later without counting it as a failure (used when a daily limit is reached). */
export function deferJob(db: Db, job: Job, minutes: number): void {
  db.prepare("UPDATE jobs SET status='queued', attempts = attempts - 1, run_after = datetime('now', ?) WHERE id = ?").run(`+${minutes} minutes`, job.id);
}

/** Try again at a specific moment (used by human pacing: breaks, lunch, off hours). Does not count as a failure. */
export function deferJobUntil(db: Db, job: Job, until: Date): void {
  db.prepare("UPDATE jobs SET status='queued', attempts = attempts - 1, run_after = ? WHERE id = ?")
    .run(until.toISOString().replace("T", " ").slice(0, 19), job.id);
}

/** Recheck queued read-only work against the new team clock; the worker still enforces all pacing gates. */
export function rescheduleQueuedReadOnlyJobs(db: Db, now = new Date()): number {
  const due = now.toISOString().replace("T", " ").slice(0, 19);
  return db.prepare(`UPDATE jobs SET run_after=?
    WHERE status='queued' AND type IN ('qualify','check_inbox') AND run_after>?`).run(due, due).changes;
}
