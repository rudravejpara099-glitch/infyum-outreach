import "server-only";
import path from "node:path";
import { hostChromeAllowed } from "@/lib/domain/workspace-rules";
import { config } from "@/lib/config";
import { openDb, type Db } from "@/lib/db/core";
import { ensureLegacyWorkspace, listMembers } from "./catalog";

// The identity catalog is never a company's operational database.
const state = globalThis as unknown as { outreachConnections?: Map<string, Db> };
function connection(file: string): Db {
  const connections = state.outreachConnections ??= new Map();
  let db = connections.get(file);
  if (!db) { db = openDb(file); connections.set(file, db); }
  return db;
}

export function getIdentityDb(): Db {
  const identity = connection(`${config.dbPath}.identity.db`);
  ensureLegacyWorkspace(identity, connection(config.dbPath));
  return identity;
}

/** IDs originate in the catalog; request input is never used as a filesystem path. */
export function getWorkspacePaths(workspaceId: string): { dbPath: string; profilesDir: string; hostChromeAllowed: boolean } {
  if (!getIdentityDb().prepare("SELECT id FROM workspace_catalog WHERE id=?").get(workspaceId)) throw new Error("Workspace not found.");
  if (workspaceId === "legacy") return { dbPath: config.dbPath, profilesDir: config.profilesDir, hostChromeAllowed: hostChromeAllowed(workspaceId) };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(workspaceId)) throw new Error("Invalid workspace storage.");
  const directory = path.join(path.dirname(config.dbPath), "workspaces", workspaceId);
  return { dbPath: path.join(directory, "outreach.db"), profilesDir: path.join(directory, "profiles"), hostChromeAllowed: false };
}

export function getWorkspaceDb(workspaceId: string): Db {
  const db = connection(getWorkspacePaths(workspaceId).dbPath);
  // Existing billing references user IDs. Mirror only this team's public identity;
  // authentication and password hashes remain in the identity catalog.
  db.prepare("INSERT INTO settings(key,value) VALUES ('workspace_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(workspaceId);
  const members = listMembers(getIdentityDb(), workspaceId);
  db.transaction(() => {
    const save = db.prepare("INSERT INTO users(id,email,name,password_hash) VALUES (?,?,?,'!identity-managed!') ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name");
    for (const member of members) save.run(member.id, member.email, member.name);
  }).immediate();
  return db;
}
