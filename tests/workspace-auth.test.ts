import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createUser, findUserByEmail } from "@/lib/db/repos/users";
import { createInvite, createWorkspace, getMembership, listWorkspaces } from "@/lib/workspaces/catalog";
import { hashPassword } from "@/lib/auth/password";

const mocks = vi.hoisted(() => ({ identity: null as unknown, operational: null as unknown, session: vi.fn(), guard: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspaces/storage", () => ({ getIdentityDb: () => mocks.identity, getWorkspaceDb: () => mocks.operational }));
vi.mock("@/lib/auth/session", () => ({ createSession: mocks.session, destroySession: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: mocks.guard }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { register } from "@/app/register/actions";
import { join } from "@/app/join/actions";
import { login, setup } from "@/app/login/actions";

let db: Db, operational: Db;
const form = (data: Record<string, string>) => { const result = new FormData(); for (const [key, value] of Object.entries(data)) result.set(key, value); return result; };
const credentials = { name: "New user", email: "new@example.test", password: "fixture-password" };
beforeEach(() => { db = openDb(":memory:"); operational = openDb(":memory:"); mocks.identity = db; mocks.operational = operational; vi.clearAllMocks(); });
afterEach(() => { db.close(); operational.close(); });

describe("private company registration", () => {
  it("creates a new identity and an owned empty workspace", async () => {
    await expect(register(undefined, form({ ...credentials, workspaceName: "New company" }))).rejects.toThrow("redirect:/");
    const user = findUserByEmail(db, credentials.email)!;
    expect(listWorkspaces(db, user.id)).toEqual([expect.objectContaining({ name: "New company", role: "owner", legacy: false })]);
    expect(mocks.session).toHaveBeenCalledWith(user.id, listWorkspaces(db, user.id)[0].id);
  });
  it("does not replace an existing login or create another workspace for it", async () => {
    const existing = createUser(db, credentials.email, "Existing", hashPassword("original-password"));
    const result = await register(undefined, form({ ...credentials, workspaceName: "Intruder" }));
    expect(result?.error).toContain("Unable to create");
    expect(listWorkspaces(db, existing.id)).toHaveLength(0);
    expect(findUserByEmail(db, credentials.email)?.name).toBe("Existing");
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

it("allows a password-verified existing identity to create a private workspace after losing its team", async () => {
  const user = createUser(db, credentials.email, "Original name", hashPassword(credentials.password));
  expect((await login(undefined, form(credentials)))?.error).toContain("Create a private workspace");
  await expect(register(undefined, form({ ...credentials, workspaceName: "Independent company" }))).rejects.toThrow("redirect:/");
  expect(findUserByEmail(db, credentials.email)?.id).toBe(user.id);
  expect(findUserByEmail(db, credentials.email)?.name).toBe("Original name");
  expect(listWorkspaces(db, user.id)[0]).toMatchObject({ name: "Independent company", role: "owner" });
});

describe("email-bound team invitation", () => {
  function invitation(email = credentials.email) {
    const owner = createUser(db, "owner@example.test", "Owner", hashPassword("owner-password"));
    const workspace = createWorkspace(db, owner.id, "Shared company");
    return { workspace, token: createInvite(db, owner.id, workspace.id, email) };
  }
  it("creates a new member only when the invitation is valid", async () => {
    const { workspace, token } = invitation();
    await expect(join(undefined, form({ ...credentials, token }))).rejects.toThrow("redirect:/");
    const user = findUserByEmail(db, credentials.email)!;
    expect(getMembership(db, user.id, workspace.id)?.role).toBe("member");
    expect(mocks.session).toHaveBeenCalledWith(user.id, workspace.id);
    expect((await join(undefined, form({ ...credentials, token })))?.error).toContain("Unable to join");
  });
  it("rolls back a new identity when the invitation email is wrong", async () => {
    const { token } = invitation("other@example.test");
    expect((await join(undefined, form({ ...credentials, token })))?.error).toContain("Unable to join");
    expect(findUserByEmail(db, credentials.email)).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("does not let an invitation take over an existing account without its password", async () => {
    const { workspace, token } = invitation();
    const user = createUser(db, credentials.email, credentials.name, hashPassword("original-password"));
    expect((await join(undefined, form({ ...credentials, token })))?.error).toContain("Unable to join");
    expect(getMembership(db, user.id, workspace.id)).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
    await expect(join(undefined, form({ ...credentials, password: "original-password", token }))).rejects.toThrow("redirect:/");
    expect(getMembership(db, user.id, workspace.id)?.role).toBe("member");
  });
  it("rate limits invite password checks", async () => {
    const { token } = invitation();
    createUser(db, credentials.email, credentials.name, hashPassword("original-password"));
    for (let i = 0; i < 5; i++) await join(undefined, form({ ...credentials, token }));
    expect((await join(undefined, form({ ...credentials, password: "original-password", token })))?.error).toContain("Too many");
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

describe("existing and fresh installation sign-in", () => {
  it("uses identity storage and selects a membership at sign-in", async () => {
    const user = createUser(db, credentials.email, credentials.name, hashPassword(credentials.password));
    const workspace = createWorkspace(db, user.id, "Company");
    await expect(login(undefined, form(credentials))).rejects.toThrow("redirect:/");
    expect(mocks.session).toHaveBeenCalledWith(user.id, workspace.id);
  });
  it("creates the first identity and legacy owner once", async () => {
    await expect(setup(undefined, form(credentials))).rejects.toThrow("redirect:/");
    const user = findUserByEmail(db, credentials.email)!;
    expect(getMembership(db, user.id, "legacy")?.role).toBe("owner");
    expect((await setup(undefined, form({ ...credentials, email: "second@example.test" })))?.error).toContain("already done");
    expect(findUserByEmail(db, "second@example.test")).toBeNull();
  });
});
