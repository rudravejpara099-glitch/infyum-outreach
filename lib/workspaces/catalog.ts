import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/core";
import { normalizeWorkspaceName } from "@/lib/domain/workspace-rules";

export type Workspace = { id: string; name: string; legacy: boolean };
export type Membership = Workspace & { role: "owner" | "member" };
type WorkspaceRecord = { id: string; name: string; legacy: number };
const workspace = (row: WorkspaceRecord): Workspace => ({ ...row, legacy: row.legacy === 1 });

/** Import the old team once, under a write lock, preserving its identities and data. */
export function ensureLegacyWorkspace(identity: Db, operational: Db): void {
  identity.transaction(() => {
    if (identity.prepare("SELECT id FROM workspace_bootstrap WHERE id=1").get()) return;
    const users = operational.prepare("SELECT id,email,name,password_hash FROM users ORDER BY id").all() as {
      id: number; email: string; name: string; password_hash: string;
    }[];
    identity.prepare("INSERT INTO workspace_catalog(id,name,legacy) VALUES ('legacy','Team workspace',1)").run();
    for (const [index, user] of users.entries()) {
      const existing = identity.prepare("SELECT id,email,password_hash FROM users WHERE id=? OR email=?").all(user.id, user.email) as typeof users;
      if (existing.some((row) => row.id !== user.id || row.email !== user.email || row.password_hash !== user.password_hash)) {
        throw new Error("Existing identities conflict with the original team. Workspace setup was stopped.");
      }
      if (!existing.length) identity.prepare("INSERT INTO users(id,email,name,password_hash) VALUES (?,?,?,?)").run(user.id, user.email, user.name, user.password_hash);
      identity.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ('legacy',?,?)").run(user.id, index === 0 ? "owner" : "member");
    }
    identity.prepare("INSERT INTO workspace_bootstrap(id) VALUES (1)").run();
  }).immediate();
}

export function createWorkspace(db: Db, userId: number, name: string): Workspace {
  const cleanName = normalizeWorkspaceName(name);
  if (!cleanName) throw new Error("Enter a company name of 1 to 100 characters.");
  return db.transaction(() => {
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(userId)) throw new Error("Sign in to create a workspace.");
    const result = { id: randomUUID(), name: cleanName, legacy: false };
    db.prepare("INSERT INTO workspace_catalog(id,name) VALUES (?,?)").run(result.id, result.name);
    db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES (?,?,'owner')").run(result.id, userId);
    return result;
  }).immediate();
}

/** Fresh installations may claim the empty original workspace only once. */
export function initializeLegacyOwner(db: Db, userId: number, name = "Team workspace"): Membership {
  const cleanName = normalizeWorkspaceName(name);
  if (!cleanName) throw new Error("Enter a company name of 1 to 100 characters.");
  return db.transaction(() => {
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(userId)) throw new Error("Sign in to create a workspace.");
    if (db.prepare("SELECT user_id FROM workspace_memberships WHERE workspace_id='legacy' LIMIT 1").get()) throw new Error("The original workspace already has a team.");
    db.prepare("INSERT INTO workspace_catalog(id,name,legacy) VALUES ('legacy',?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name").run(cleanName);
    db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ('legacy',?,'owner')").run(userId);
    return getMembership(db, userId, "legacy")!;
  }).immediate();
}

export function listWorkspaces(db: Db, userId: number): Membership[] {
  const rows = db.prepare(`SELECT w.*,m.role FROM workspace_catalog w JOIN workspace_memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY (m.role='owner') DESC,w.name,w.id`).all(userId) as (WorkspaceRecord & Pick<Membership, "role">)[];
  return rows.map((row) => ({ ...workspace(row), role: row.role }));
}

export function getMembership(db: Db, userId: number, workspaceId: string): Membership | null {
  return listWorkspaces(db, userId).find((row) => row.id === workspaceId) ?? null;
}

export function requireWorkspaceOwner(db: Db, actorId: number, workspaceId: string): void {
  if (getMembership(db, actorId, workspaceId)?.role !== "owner") throw new Error("Only the workspace owner can manage the team.");
}

export function listMembers(db: Db, workspaceId: string): { id: number; email: string; name: string; role: "owner" | "member" }[] {
  return db.prepare(`SELECT u.id,u.email,u.name,m.role FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? ORDER BY m.role DESC,u.name,u.id`).all(workspaceId) as ReturnType<typeof listMembers>;
}

export function removeMember(db: Db, actorId: number, workspaceId: string, userId: number): void {
  db.transaction(() => {
    requireWorkspaceOwner(db, actorId, workspaceId);
    if (getMembership(db, userId, workspaceId)?.role === "owner") throw new Error("The workspace owner cannot be removed.");
    db.prepare("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?").run(workspaceId, userId);
    db.prepare("UPDATE workspace_sessions SET revoked_at=? WHERE workspace_id=? AND user_id=? AND revoked_at IS NULL").run(Date.now(), workspaceId, userId);
    db.prepare("UPDATE workspace_invites SET revoked_at=? WHERE workspace_id=? AND email=(SELECT email FROM users WHERE id=?) AND consumed_at IS NULL AND revoked_at IS NULL").run(Date.now(), workspaceId, userId);
  }).immediate();
}

export { createInvite, acceptInvite, revokeInvite, listInvites } from "./invites";
export { createWorkspaceSession, validWorkspaceSession, revokeWorkspaceSession } from "./sessions";
