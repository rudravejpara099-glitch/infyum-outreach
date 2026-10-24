import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "@/lib/db/core";
import { createUser, getUser } from "@/lib/db/repos/users";
import { createCampaign, listCampaigns } from "@/lib/db/repos/campaigns";
import { createWorkspace } from "@/lib/workspaces/catalog";

const state = vi.hoisted(() => ({ dbPath: "", profilesDir: "", workspaceId: "legacy" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ config: { get dbPath() { return state.dbPath; }, get profilesDir() { return state.profilesDir; } } }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ id: 11, email: "owner@example.test", workspaceId: state.workspaceId })) }));
import { getIdentityDb, getWorkspaceDb, getWorkspacePaths } from "@/lib/workspaces/storage";
import { getDb } from "@/lib/db";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "outreach-storage-"));
  state.dbPath = path.join(directory, "original.db"); state.profilesDir = path.join(directory, "profiles"); state.workspaceId = "legacy";
  const existing = openDb(state.dbPath);
  existing.prepare("INSERT INTO users(id,email,name,password_hash) VALUES (11,'owner@example.test','Original owner','original-hash')").run();
  campaign(existing, "Original campaign"); existing.close();
});
afterEach(() => {
  const cache = (globalThis as unknown as { outreachConnections?: Map<string, Db> }).outreachConnections;
  for (const [file, db] of cache ?? []) if (file.startsWith(directory)) { db.close(); cache!.delete(file); }
  rmSync(directory, { recursive: true, force: true });
});
function campaign(db: Db, name: string) {
  return createCampaign(db, { name, niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "fixture");
}

describe("workspace storage boundary", () => {
  it("imports original identities once and preserves existing IDs, passwords and campaigns", () => {
    const identity = getIdentityDb();
    expect(getUser(identity, 11)).toMatchObject({ id: 11, email: "owner@example.test", passwordHash: "original-hash" });
    expect(getWorkspacePaths("legacy")).toEqual({ dbPath: state.dbPath, profilesDir: state.profilesDir, hostChromeAllowed: true });
    const original = getWorkspaceDb("legacy");
    expect(getUser(original, 11)?.passwordHash).toBe("original-hash");
    expect(listCampaigns(original)[0]).toMatchObject({ id: 1, name: "Original campaign" });
    createUser(identity, "later@example.test", "Later", "later-hash");
    expect(getIdentityDb()).toBe(identity);
    expect(identity.prepare("SELECT count(*) n FROM users").get()).toEqual({ n: 2 });
    expect(original.prepare("SELECT count(*) n FROM users").get()).toEqual({ n: 1 });
  });
  it("keeps company records separate even when local numeric IDs overlap", () => {
    const identity = getIdentityDb();
    const one = createUser(identity, "one@example.test", "One", "one-secret"), two = createUser(identity, "two@example.test", "Two", "two-secret");
    const workspaceOne = createWorkspace(identity, one.id, "Company one"), workspaceTwo = createWorkspace(identity, two.id, "Company two");
    const dbOne = getWorkspaceDb(workspaceOne.id), dbTwo = getWorkspaceDb(workspaceTwo.id);
    expect(campaign(dbOne, "First private campaign").id).toBe(1);
    expect(campaign(dbTwo, "Second private campaign").id).toBe(1);
    expect(listCampaigns(dbOne).map(row => row.name)).toEqual(["First private campaign"]);
    expect(listCampaigns(dbTwo).map(row => row.name)).toEqual(["Second private campaign"]);
    expect(getUser(dbOne, two.id)).toBeNull();
    expect(getUser(dbTwo, one.id)).toBeNull();
    expect(getUser(dbOne, one.id)?.passwordHash).toBe("!identity-managed!");
    expect(getUser(identity, one.id)?.passwordHash).toBe("one-secret");
    expect(getWorkspacePaths(workspaceOne.id).hostChromeAllowed).toBe(false);
    expect(getWorkspacePaths(workspaceOne.id).profilesDir).not.toBe(getWorkspacePaths(workspaceTwo.id).profilesDir);
  });
  it("rejects unknown IDs and path traversal before opening storage", () => {
    for (const value of ["../original", "/tmp/other", "00000000-0000-4000-8000-000000000000"]) expect(() => getWorkspacePaths(value)).toThrow("Workspace not found");
  });
  it("scopes reads to the verified workspace and rejects old or unstamped forms", async () => {
    const identity = getIdentityDb(), member = createUser(identity, "private@example.test", "Private", "secret");
    const workspace = createWorkspace(identity, member.id, "Private company");
    state.workspaceId = workspace.id;
    expect(await getDb()).toBe(getWorkspaceDb(workspace.id));
    const stale = new FormData(); stale.set("__workspace", "legacy");
    await expect(getDb(stale)).rejects.toThrow("workspace changed");
    await expect(getDb(new FormData())).rejects.toThrow("workspace changed");
    stale.set("__workspace", workspace.id);
    expect(await getDb(stale)).toBe(getWorkspaceDb(workspace.id));
    expect(listCampaigns(await getDb())).toHaveLength(0);
    expect(listCampaigns(getWorkspaceDb("legacy"))).toHaveLength(1);
  });
});
