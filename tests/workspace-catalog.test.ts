import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import {
  ensureLegacyWorkspace, initializeLegacyOwner, createWorkspace, listWorkspaces,
  getMembership, listMembers, createInvite, acceptInvite, revokeInvite, listInvites,
  removeMember, createWorkspaceSession, validWorkspaceSession, revokeWorkspaceSession,
} from "@/lib/workspaces/catalog";

let db: Db;
let operational: Db;
let owner: number;
let member: number;
let outsider: number;
beforeEach(() => {
  db = openDb(":memory:");
  operational = openDb(":memory:");
  owner = createUser(db, "owner@example.com", "Owner", "owner-hash").id;
  member = createUser(db, "member@example.com", "Member", "member-hash").id;
  outsider = createUser(db, "outsider@example.com", "Outsider", "outsider-hash").id;
});
afterEach(() => { db.close(); operational.close(); });

describe("company workspace catalog", () => {
  it("creates separate companies and exposes only memberships for each person", () => {
    const companyA = createWorkspace(db, owner, "  Company A  ");
    const companyB = createWorkspace(db, outsider, "Company B");
    expect(companyA).toMatchObject({ name: "Company A", legacy: false });
    expect(companyA.id).not.toBe(companyB.id);
    expect(listWorkspaces(db, owner)).toEqual([{ ...companyA, role: "owner" }]);
    expect(getMembership(db, member, companyA.id)).toBeNull();
    expect(listMembers(db, companyA.id)).toEqual([{ id: owner, email: "owner@example.com", name: "Owner", role: "owner" }]);
    expect(listWorkspaces(db, outsider).map((row) => row.id)).toEqual([companyB.id]);
  });

  it("rejects invalid company names and identities without partial companies", () => {
    expect(() => createWorkspace(db, owner, " ")).toThrow();
    expect(() => createWorkspace(db, owner, "x".repeat(101))).toThrow();
    expect(() => createWorkspace(db, 999, "Other")).toThrow();
    expect(listWorkspaces(db, owner)).toEqual([]);
  });

  it("imports the original identities exactly once, preserving hashes and ownership", () => {
    db.prepare("DELETE FROM users").run();
    const first = createUser(operational, "first@example.com", "First", "secret-hash");
    const second = createUser(operational, "second@example.com", "Second", "second-hash");
    ensureLegacyWorkspace(db, operational);
    expect(db.prepare("SELECT id,email,password_hash FROM users ORDER BY id").all()).toEqual([
      { id: first.id, email: first.email, password_hash: "secret-hash" },
      { id: second.id, email: second.email, password_hash: "second-hash" },
    ]);
    expect(getMembership(db, first.id, "legacy")?.role).toBe("owner");
    expect(getMembership(db, second.id, "legacy")?.role).toBe("member");
    const newUser = createUser(db, "new@example.com", "New company", "new-hash");
    createWorkspace(db, newUser.id, "Private");
    createUser(operational, "late@example.com", "Late", "late-hash");
    ensureLegacyWorkspace(db, operational);
    expect(listMembers(db, "legacy")).toHaveLength(2);
    expect(getMembership(db, newUser.id, "legacy")).toBeNull();
  });

  it("rolls back bootstrap on identity conflict instead of linking the wrong user", () => {
    createUser(operational, "different@example.com", "Different", "other-hash");
    expect(() => ensureLegacyWorkspace(db, operational)).toThrow("conflict");
    expect(db.prepare("SELECT * FROM workspace_catalog").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM workspace_bootstrap").all()).toEqual([]);
  });

  it("allows a fresh legacy owner once and refuses a later takeover", () => {
    ensureLegacyWorkspace(db, operational);
    expect(initializeLegacyOwner(db, owner, "Our team")).toEqual({ id: "legacy", name: "Our team", legacy: true, role: "owner" });
    expect(() => initializeLegacyOwner(db, outsider, "Takeover")).toThrow("already");
    expect(() => removeMember(db, owner, "legacy", owner)).toThrow("cannot be removed");
    expect(() => initializeLegacyOwner(db, 999)).toThrow();
  });
});

describe("workspace invitations", () => {
  it("binds a one-use invitation to its email; wrong email does not consume it", () => {
    const company = createWorkspace(db, owner, "Company");
    const token = createInvite(db, owner, company.id, "  MEMBER@EXAMPLE.COM ");
    expect(token).toHaveLength(43);
    expect(() => acceptInvite(db, outsider, token)).toThrow("invited email");
    expect(acceptInvite(db, member, token)).toEqual({ ...company, role: "member" });
    expect(() => acceptInvite(db, member, token)).toThrow();
    expect(listMembers(db, company.id)).toHaveLength(2);
    expect(listWorkspaces(db, outsider)).toEqual([]);
    expect(listInvites(db, company.id)).toEqual([]);
    const stored = db.prepare("SELECT token_hash FROM workspace_invites").get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects expired, revoked, replaced and malformed links", () => {
    const company = createWorkspace(db, owner, "Company");
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const expired = createInvite(db, owner, company.id, "member@example.com", past);
    expect(() => acceptInvite(db, member, expired)).toThrow();
    const replaced = createInvite(db, owner, company.id, "member@example.com");
    const current = createInvite(db, owner, company.id, "member@example.com");
    expect(() => acceptInvite(db, member, replaced)).toThrow();
    const invitations = listInvites(db, company.id);
    expect(invitations).toHaveLength(1);
    expect(Object.keys(invitations[0]).sort()).toEqual(["email", "expiresAt", "id"]);
    revokeInvite(db, owner, company.id, invitations[0].id);
    expect(() => acceptInvite(db, member, current)).toThrow();
    expect(() => acceptInvite(db, member, "invalid")).toThrow();
  });

  it("enforces owner rights for team changes and scopes revocations to their company", () => {
    const company = createWorkspace(db, owner, "Company");
    const other = createWorkspace(db, outsider, "Other");
    const token = createInvite(db, owner, company.id, "member@example.com");
    acceptInvite(db, member, token);
    expect(() => createInvite(db, member, company.id, "new@example.com")).toThrow("owner");
    expect(() => createInvite(db, outsider, company.id, "new@example.com")).toThrow("owner");
    expect(() => createInvite(db, owner, company.id, "bad address")).toThrow("email");
    const secondToken = createInvite(db, owner, company.id, "outsider@example.com");
    const invitation = listInvites(db, company.id)[0];
    expect(() => revokeInvite(db, member, company.id, invitation.id)).toThrow("owner");
    revokeInvite(db, outsider, other.id, invitation.id);
    expect(acceptInvite(db, outsider, secondToken).id).toBe(company.id);
    expect(() => removeMember(db, member, company.id, outsider)).toThrow("owner");
    removeMember(db, owner, company.id, outsider);
    expect(getMembership(db, outsider, company.id)).toBeNull();
    expect(getMembership(db, outsider, other.id)?.role).toBe("owner");
  });
});

describe("revocable workspace sessions", () => {
  it("binds sessions to the exact user and workspace and stores only hashes", () => {
    const company = createWorkspace(db, owner, "Company");
    const other = createWorkspace(db, owner, "Other");
    const expiresAt = Date.now() + 60_000;
    const token = createWorkspaceSession(db, owner, company.id, expiresAt);
    expect(validWorkspaceSession(db, owner, company.id, token)).toBe(true);
    expect(validWorkspaceSession(db, outsider, company.id, token)).toBe(false);
    expect(validWorkspaceSession(db, owner, other.id, token)).toBe(false);
    expect(validWorkspaceSession(db, owner, company.id, token, expiresAt)).toBe(false);
    expect(validWorkspaceSession(db, owner, company.id, "invalid")).toBe(false);
    const stored = db.prepare("SELECT token_hash FROM workspace_sessions").get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(token);
    revokeWorkspaceSession(db, token);
    expect(validWorkspaceSession(db, owner, company.id, token)).toBe(false);
  });

  it("refuses sessions for outsiders or invalid expiry and invalidates removed members permanently", () => {
    const company = createWorkspace(db, owner, "Company");
    expect(() => createWorkspaceSession(db, member, company.id, Date.now() + 1000)).toThrow();
    expect(() => createWorkspaceSession(db, owner, company.id, Date.now() - 1000)).toThrow();
    expect(() => createWorkspaceSession(db, owner, company.id, Infinity)).toThrow();
    acceptInvite(db, member, createInvite(db, owner, company.id, "member@example.com"));
    const token = createWorkspaceSession(db, member, company.id, Date.now() + 60_000);
    removeMember(db, owner, company.id, member);
    expect(validWorkspaceSession(db, member, company.id, token)).toBe(false);
    acceptInvite(db, member, createInvite(db, owner, company.id, "member@example.com"));
    expect(validWorkspaceSession(db, member, company.id, token)).toBe(false);
  });
});

 it("prefers a person's own private company over an invited team and revokes invites on removal", () => {
  const shared = createWorkspace(db, owner, "A shared team");
  const own = createWorkspace(db, member, "Z private company");
  acceptInvite(db, member, createInvite(db, owner, shared.id, "member@example.com"));
  expect(listWorkspaces(db, member).map(row => row.id)).toEqual([own.id, shared.id]);
  const pending = createInvite(db, owner, shared.id, "member@example.com");
  removeMember(db, owner, shared.id, member);
  expect(() => acceptInvite(db, member, pending)).toThrow();
  expect(getMembership(db, member, shared.id)).toBeNull();
 });
