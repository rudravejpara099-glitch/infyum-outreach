import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/core";
import { normalizeInviteEmail } from "@/lib/domain/workspace-rules";
import { getMembership, requireWorkspaceOwner, type Membership } from "./catalog";
import { hashToken, isToken, newToken } from "./tokens";

export function createInvite(db: Db, actorId: number, workspaceId: string, email: string, now = Date.now()): string {
  const cleanEmail = normalizeInviteEmail(email);
  if (!cleanEmail) throw new Error("Enter a valid email address.");
  return db.transaction(() => {
    requireWorkspaceOwner(db, actorId, workspaceId);
    const token = newToken();
    // A replacement link invalidates the older link for this person.
    db.prepare("UPDATE workspace_invites SET revoked_at=? WHERE workspace_id=? AND email=? AND consumed_at IS NULL AND revoked_at IS NULL").run(now, workspaceId, cleanEmail);
    db.prepare("INSERT INTO workspace_invites(id,workspace_id,email,token_hash,expires_at) VALUES (?,?,?,?,?)").run(randomUUID(), workspaceId, cleanEmail, hashToken(token), now + 7 * 24 * 60 * 60 * 1000);
    return token;
  }).immediate();
}

export function acceptInvite(db: Db, userId: number, token: string, now = Date.now()): Membership {
  if (!isToken(token)) throw new Error("This invitation is invalid or has expired.");
  return db.transaction(() => {
    const invitation = db.prepare("SELECT id,workspace_id,email FROM workspace_invites WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?").get(hashToken(token), now) as { id: string; workspace_id: string; email: string } | undefined;
    const user = db.prepare("SELECT email FROM users WHERE id=?").get(userId) as { email: string } | undefined;
    if (!invitation || !user || user.email.trim().toLowerCase() !== invitation.email) throw new Error("Use the invited email to accept this invitation before it expires.");
    db.prepare("INSERT OR IGNORE INTO workspace_memberships(workspace_id,user_id,role) VALUES (?,?,'member')").run(invitation.workspace_id, userId);
    db.prepare("UPDATE workspace_invites SET consumed_at=? WHERE id=?").run(now, invitation.id);
    return getMembership(db, userId, invitation.workspace_id)!;
  }).immediate();
}

export function revokeInvite(db: Db, actorId: number, workspaceId: string, inviteId: string): void {
  db.transaction(() => {
    requireWorkspaceOwner(db, actorId, workspaceId);
    db.prepare("UPDATE workspace_invites SET revoked_at=? WHERE id=? AND workspace_id=? AND revoked_at IS NULL").run(Date.now(), inviteId, workspaceId);
  }).immediate();
}

export function listInvites(db: Db, workspaceId: string): { id: string; email: string; expiresAt: number }[] {
  return db.prepare("SELECT id,email,expires_at AS expiresAt FROM workspace_invites WHERE workspace_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY email,id").all(workspaceId, Date.now()) as ReturnType<typeof listInvites>;
}
