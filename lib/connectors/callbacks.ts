import type { Db } from "@/lib/db/core";
import { getDeviceCommand } from "./commands";
import { canRequestConnectorComment } from "@/lib/domain/connector";

export function requestDeviceCallback(db: Db, deviceId: string, commandId: string, callbackId: string, context: string, now = Date.now()): boolean {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(callbackId) || typeof context !== "string" || !context.trim() || context.length > 5000 || context.includes("\0")) throw new Error("Invalid writing request.");
  return db.transaction(() => {
    const command = getDeviceCommand(db, commandId);
    if (!command || command.deviceId !== deviceId || command.kind !== "warmUp" || command.status !== "running" || command.expiresAt <= now) return false;
    if (!db.prepare(`SELECT j.id FROM jobs j JOIN account_devices a ON a.account_id=j.account_id
      WHERE j.id=? AND j.status='running' AND j.attempts=? AND a.device_id=?`).get(command.jobId, command.jobAttempt, deviceId)) return false;
    if (command.callback && !command.callbackResponse) return command.callback.id === callbackId && command.callback.context === context;
    if (command.callback?.id === callbackId) return false;
    const countKey = `device_callback_count_${command.id}`;
    const count = db.prepare("SELECT value FROM settings WHERE key=?").get(countKey) as { value: string } | undefined;
    const issued = count ? Number(count.value) : 0;
    if (!canRequestConnectorComment(command.args.pieces, issued)) return false;
    const accepted = db.prepare(`UPDATE device_commands SET callback_json=?,callback_response_json=NULL WHERE id=? AND device_id=? AND status='running'
      AND EXISTS(SELECT 1 FROM jobs j JOIN account_devices a ON a.account_id=j.account_id WHERE j.id=device_commands.job_id AND j.status='running' AND j.attempts=device_commands.job_attempt AND a.device_id=device_commands.device_id)`)
      .run(JSON.stringify({ id: callbackId, context }), commandId, deviceId).changes === 1;
    if (accepted) db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(countKey, String(issued + 1));
    return accepted;
  }).immediate();
}
export function respondDeviceCallback(db: Db, id: string, callbackId: string, response: string | { error: string }, now = Date.now()): boolean {
  const value = typeof response === "string" ? response : response?.error;
  if (typeof value !== "string" || !value.trim() || value.length > 2000 || value.includes("\0")) throw new Error("Invalid writing response.");
  return db.prepare(`UPDATE device_commands SET callback_response_json=? WHERE id=? AND kind='warmUp' AND status='running' AND expires_at>?
    AND json_extract(callback_json,'$.id')=? AND callback_response_json IS NULL
    AND EXISTS(SELECT 1 FROM jobs j JOIN account_devices a ON a.account_id=j.account_id WHERE j.id=device_commands.job_id AND j.status='running' AND j.attempts=device_commands.job_attempt AND a.device_id=device_commands.device_id)`)
    .run(JSON.stringify({ id: callbackId, response }), id, now, callbackId).changes === 1;
}
