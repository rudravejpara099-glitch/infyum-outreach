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

/** Takes the oldest due job. The transaction makes it safe even if two workers ever ran. */
export function claimNext(db: Db, types?: string[]): Job | null {
  return db.transaction(() => {
    const filter = types?.length ? `AND type IN (${types.map(() => "?").join(",")})` : "";
    const r = db.prepare(`SELECT * FROM jobs WHERE status='queued' AND run_after <= datetime('now') ${filter} ORDER BY run_after, id LIMIT 1`)
      .get(...(types ?? [])) as Record<string, unknown> | undefined;
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
