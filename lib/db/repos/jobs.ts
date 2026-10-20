import type { Db } from "../core";
import type { Job } from "../types";

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
export function claimNext(db: Db, types?: string[], lane?: Lane): Job | null {
  return db.transaction(() => {
    const where = ["status='queued'", "run_after <= datetime('now')"];
    const args: unknown[] = [];
    if (types?.length) { where.push(`type IN (${types.map(() => "?").join(",")})`); args.push(...types); }
    if (lane) {
      if (lane.accountId === null) where.push("account_id IS NULL");
      else { where.push("account_id = ?"); args.push(lane.accountId); }
    }
    const r = db.prepare(`SELECT * FROM jobs WHERE ${where.join(" AND ")} ORDER BY run_after, id LIMIT 1`).get(...args) as Record<string, unknown> | undefined;
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
export function listJobs(db: Db, limit = 100): Job[] {
  return (db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(map);
}
/** A worker that crashed mid-job leaves it 'running'. On start, put those back in the queue. */
export function requeueStuck(db: Db): number {
  return db.prepare("UPDATE jobs SET status='queued' WHERE status='running'").run().changes;
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

/** Try again later without counting it as a failure (used when a daily limit is reached). */
export function deferJob(db: Db, job: Job, minutes: number): void {
  db.prepare("UPDATE jobs SET status='queued', attempts = attempts - 1, run_after = datetime('now', ?) WHERE id = ?").run(`+${minutes} minutes`, job.id);
}

/** Try again at a specific moment (used by human pacing: breaks, lunch, off hours). Does not count as a failure. */
export function deferJobUntil(db: Db, job: Job, until: Date): void {
  db.prepare("UPDATE jobs SET status='queued', attempts = attempts - 1, run_after = ? WHERE id = ?")
    .run(until.toISOString().replace("T", " ").slice(0, 19), job.id);
}
