import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/core";
import { connectorKindAllowed, connectorWrites, isConnectorKind, validConnectorArgs, validConnectorResult } from "@/lib/domain/connector";
import type { Command, ConnectorKind } from "./protocol";
export type { Command } from "./protocol";
type Row = { id: string; device_id: string; account_id: number; job_id: number; job_attempt: number; kind: ConnectorKind; args_json: string; status: Command["status"]; expires_at: number; result_json: string | null; error: string | null; callback_json: string | null; callback_response_json: string | null };
const map = (r: Row): Command => ({ id: r.id, deviceId: r.device_id, accountId: r.account_id, jobId: r.job_id, jobAttempt: r.job_attempt, kind: r.kind, args: JSON.parse(r.args_json), status: r.status, expiresAt: r.expires_at, result: r.result_json === null ? null : JSON.parse(r.result_json), error: r.error, ...(r.callback_json ? { callback: JSON.parse(r.callback_json) } : {}), ...(r.callback_response_json ? { callbackResponse: JSON.parse(r.callback_response_json) } : {}) });
export function bindAccountDevice(db: Db, accountId: number, deviceId: string, now = Date.now()): void {
  if (!/^[a-f0-9-]{36}$/.test(deviceId)) throw new Error("Invalid device.");
  db.transaction(() => {
    expire(db, now);
    const pending = db.prepare("SELECT * FROM device_commands WHERE account_id=? AND status IN ('queued','running')").all(accountId) as Row[];
    for (const row of pending) {
      if (active(db, map(row))) continue;
      // Keep possible browser writes as uncertain evidence, never replayable work.
      const status = row.status === "running" && connectorWrites(row.kind) ? "uncertain" : "failed";
      db.prepare("UPDATE device_commands SET status=?,error='The previous device task is no longer active. Review any partial Instagram actions.' WHERE id=? AND status IN ('queued','running')").run(status, row.id);
    }
    if (db.prepare("SELECT id FROM device_commands WHERE account_id=? AND status IN ('queued','running')").get(accountId)) throw new Error("Wait for the current account task before changing devices.");
    db.prepare("INSERT INTO account_devices(account_id,device_id) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET device_id=excluded.device_id").run(accountId, deviceId);
  }).immediate();
}
export function getAccountDevice(db: Db, accountId: number): string | null {
  return (db.prepare("SELECT device_id FROM account_devices WHERE account_id=?").get(accountId) as { device_id: string } | undefined)?.device_id ?? null;
}
export function getDeviceCommand(db: Db, id: string): Command | null {
  const row = db.prepare("SELECT * FROM device_commands WHERE id=?").get(id) as Row | undefined;
  return row ? map(row) : null;
}
function active(db: Db, command: Command): boolean {
  return !!db.prepare(`SELECT j.id FROM jobs j JOIN account_devices d ON d.account_id=j.account_id
    WHERE j.id=? AND j.account_id=? AND j.status='running' AND d.device_id=? AND j.attempts=?`).get(command.jobId, command.accountId, command.deviceId, command.jobAttempt);
}
function expire(db: Db, now: number): void {
  db.prepare(`UPDATE device_commands SET status=CASE WHEN kind IN ('warmUp','sendMessages') AND status='running' THEN 'uncertain' ELSE 'failed' END,
    error='The device task expired. Check Instagram before retrying any action.' WHERE status IN ('queued','running') AND expires_at<=?`).run(now);
}
export function createDeviceCommand(db: Db, input: { deviceId: string; accountId: number; jobId: number; kind: ConnectorKind; args: Record<string, unknown> }, now = Date.now()): Command {
  if (!isConnectorKind(input.kind) || !validConnectorArgs(input.kind, input.args)) throw new Error("Invalid device task arguments.");
  return db.transaction(() => {
    expire(db, now);
    const job = db.prepare("SELECT type,attempts FROM jobs WHERE id=? AND account_id=? AND status='running'").get(input.jobId, input.accountId) as { type: string; attempts: number } | undefined;
    if (!job || !connectorKindAllowed(job.type, input.kind) || getAccountDevice(db, input.accountId) !== input.deviceId) throw new Error("This device task does not match the active account task.");
    const previous = db.prepare("SELECT * FROM device_commands WHERE job_id=? AND kind=? ORDER BY job_attempt DESC,expires_at DESC LIMIT 1").get(input.jobId, input.kind) as Row | undefined;
    if (previous) {
      if (connectorWrites(input.kind)) throw new Error("This device task already exists. Review its result before retrying.");
      if (previous.args_json !== JSON.stringify(input.args)) throw new Error("The device task changed. Review it before retrying.");
      if (previous.job_attempt === job.attempts) {
        if (previous.device_id !== input.deviceId) throw new Error("The device task changed. Review it before retrying.");
        return map(previous);
      }
      if (previous.status !== "failed" || previous.job_attempt >= job.attempts) throw new Error("The previous device task is still active or has already completed.");
      // A later read-only attempt may use an explicitly rebound device. The
      // current binding and running job were verified above; writes never reach here.
    }
    const id = randomUUID();
    db.prepare("INSERT INTO device_commands(id,device_id,account_id,job_id,job_attempt,kind,args_json,status,expires_at) VALUES (?,?,?,?,?,?,?,'queued',?)").run(id, input.deviceId, input.accountId, input.jobId, job.attempts, input.kind, JSON.stringify(input.args), now + 30 * 60_000);
    return getDeviceCommand(db, id)!;
  }).immediate();
}
export function claimDeviceCommand(db: Db, deviceId: string, now = Date.now()): Command | null {
  return db.transaction(() => {
    expire(db, now);
    if (db.prepare("SELECT id FROM device_commands WHERE device_id=? AND status='running'").get(deviceId)) return null;
    const rows = db.prepare("SELECT * FROM device_commands WHERE device_id=? AND status='queued' ORDER BY expires_at,id").all(deviceId) as Row[];
    for (const row of rows) {
      const command = map(row);
      if (!active(db, command)) { db.prepare("UPDATE device_commands SET status='failed',error='The account task is no longer active.' WHERE id=? AND status='queued'").run(row.id); continue; }
      if (db.prepare("UPDATE device_commands SET status='running',started_at=? WHERE id=? AND status='queued'").run(now, row.id).changes) return getDeviceCommand(db, row.id);
    }
    return null;
  }).immediate();
}
export function completeDeviceCommand(db: Db, deviceId: string, id: string, result: unknown, error?: string, now = Date.now()): boolean {
  return db.transaction(() => {
    expire(db, now);
    const command = getDeviceCommand(db, id);
    if (!command || command.deviceId !== deviceId || command.status !== "running" || !active(db, command)) return false;
    if (error !== undefined && (!error.trim() || error.length > 2000 || error.includes("\0"))) throw new Error("Invalid device task error.");
    if (!error && !validConnectorResult(command.kind, result)) throw new Error("Invalid device task result.");
    return db.prepare("UPDATE device_commands SET status=?,result_json=?,error=? WHERE id=? AND device_id=? AND status='running'").run(error ? connectorWrites(command.kind) ? "uncertain" : "failed" : "done", error ? null : JSON.stringify(result), error ?? null, id, deviceId).changes === 1;
  }).immediate();
}
/** Never replay an operation whose browser may have already applied it. */
export function cancelDeviceCommand(db: Db, id: string, reason: string, now = Date.now()): void {
  if (!reason.trim() || reason.length > 2000) throw new Error("Invalid cancellation reason.");
  db.prepare(`UPDATE device_commands SET status=CASE WHEN status='running' AND kind IN ('warmUp','sendMessages') THEN 'uncertain' ELSE 'failed' END,error=?,expires_at=MIN(expires_at,?)
    WHERE id=? AND status IN ('queued','running')`).run(reason, now, id);
}
export { requestDeviceCallback, respondDeviceCallback } from "./callbacks";
