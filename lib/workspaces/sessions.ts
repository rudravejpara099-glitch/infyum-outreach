import type { Db } from "@/lib/db/core";
import { getMembership } from "./catalog";
import { hashToken, isToken, newToken } from "./tokens";

export function createWorkspaceSession(db: Db, userId: number, workspaceId: string, expiresAt: number): string {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error("Session expiry must be in the future.");
  return db.transaction(() => {
    if (!getMembership(db, userId, workspaceId)) throw new Error("You do not belong to this workspace.");
    const token = newToken();
    db.prepare("INSERT INTO workspace_sessions(token_hash,workspace_id,user_id,expires_at) VALUES (?,?,?,?)").run(hashToken(token), workspaceId, userId, expiresAt);
    return token;
  }).immediate();
}

export function validWorkspaceSession(db: Db, userId: number, workspaceId: string, token: string, now = Date.now()): boolean {
  if (!isToken(token)) return false;
  return !!db.prepare(`SELECT s.token_hash FROM workspace_sessions s JOIN workspace_memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id WHERE s.token_hash=? AND s.user_id=? AND s.workspace_id=? AND s.revoked_at IS NULL AND s.expires_at>?`).get(hashToken(token), userId, workspaceId, now);
}

export function revokeWorkspaceSession(db: Db, token: string): void {
  if (isToken(token)) db.prepare("UPDATE workspace_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(Date.now(), hashToken(token));
}
