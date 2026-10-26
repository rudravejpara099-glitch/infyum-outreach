import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/core";
import { getMembership } from "@/lib/workspaces/catalog";
import { DEVICE_PAIRING_TTL_MS } from "@/lib/domain/connector";

export type Device = { id: string; workspaceId: string; userId: number; label: string; lastSeen: number | null };
type Row = { id: string; workspace_id: string; user_id: number; label: string; last_seen: number | null };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const credential = () => randomBytes(32).toString("base64url");
const validToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
const map = (row: Row): Device => ({ id: row.id, workspaceId: row.workspace_id, userId: row.user_id, label: row.label, lastSeen: row.last_seen });

export function createPairing(identity: Db, userId: number, workspaceId: string, now = Date.now()): string {
  if (!getMembership(identity, userId, workspaceId)) throw new Error("Join this workspace before connecting a device.");
  const code = credential();
  identity.prepare("INSERT INTO device_pairings(token_hash,workspace_id,user_id,expires_at) VALUES (?,?,?,?)").run(hash(code), workspaceId, userId, now + DEVICE_PAIRING_TTL_MS);
  return code;
}

export function exchangePairing(identity: Db, code: string, label: string, now = Date.now()): { device: Device; token: string } {
  if (!validToken(code) || typeof label !== "string" || !label.trim() || label.length > 100 || /[\p{Cc}\p{Cf}]/u.test(label)) throw new Error("This connection code or device name is invalid.");
  return identity.transaction(() => {
    const pairing = identity.prepare("SELECT workspace_id,user_id FROM device_pairings WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL").get(hash(code), now) as { workspace_id: string; user_id: number } | undefined;
    if (!pairing || !getMembership(identity, pairing.user_id, pairing.workspace_id)) throw new Error("This connection code expired or was already used. Create another one in Accounts.");
    const token = credential();
    const device: Device = { id: randomUUID(), workspaceId: pairing.workspace_id, userId: pairing.user_id, label: label.trim(), lastSeen: now };
    identity.prepare("UPDATE device_pairings SET consumed_at=? WHERE token_hash=?").run(now, hash(code));
    identity.prepare("INSERT INTO paired_devices(id,token_hash,workspace_id,user_id,label,last_seen) VALUES (?,?,?,?,?,?)").run(device.id, hash(token), device.workspaceId, device.userId, device.label, now);
    return { device, token };
  }).immediate();
}

export function authenticateDevice(identity: Db, token: string, now = Date.now()): Device | null {
  if (!validToken(token) || !Number.isSafeInteger(now) || now < 0) return null;
  const row = identity.prepare(`SELECT d.* FROM paired_devices d JOIN workspace_memberships m
    ON m.workspace_id=d.workspace_id AND m.user_id=d.user_id WHERE d.token_hash=? AND d.revoked_at IS NULL`).get(hash(token)) as Row | undefined;
  return row ? map(row) : null;
}
export function touchDevice(identity: Db, id: string, now = Date.now()): void {
  identity.prepare("UPDATE paired_devices SET last_seen=? WHERE id=? AND revoked_at IS NULL").run(now, id);
}
export function listDevices(identity: Db, workspaceId: string): Device[] {
  return (identity.prepare("SELECT * FROM paired_devices WHERE workspace_id=? AND revoked_at IS NULL ORDER BY label,id").all(workspaceId) as Row[]).map(map);
}
export function revokeDevice(identity: Db, actorUserId: number, workspaceId: string, deviceId: string): void {
  const membership = getMembership(identity, actorUserId, workspaceId);
  const row = identity.prepare("SELECT user_id FROM paired_devices WHERE id=? AND workspace_id=?").get(deviceId, workspaceId) as { user_id: number } | undefined;
  if (!membership || !row || (membership.role !== "owner" && row.user_id !== actorUserId)) throw new Error("Only the device owner or workspace owner can disconnect it.");
  identity.prepare("UPDATE paired_devices SET revoked_at=? WHERE id=? AND workspace_id=?").run(Date.now(), deviceId, workspaceId);
}
