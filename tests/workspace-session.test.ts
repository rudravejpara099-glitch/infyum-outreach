import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { openDb, type Db } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import { createWorkspace, validWorkspaceSession } from "@/lib/workspaces/catalog";
import { config } from "@/lib/config";

const mocks = vi.hoisted(() => ({ db: null as unknown, cookie: "" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspaces/storage", () => ({ getIdentityDb: () => mocks.db }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => mocks.cookie ? { value: mocks.cookie } : undefined,
  set: (_name: string, token: string) => { mocks.cookie = token; },
  delete: () => { mocks.cookie = ""; },
}) }));
import { createSession, destroySession, readSession } from "@/lib/auth/session";

let db: Db, userId: number, workspaceId: string;
beforeEach(() => { db = openDb(":memory:"); mocks.db = db; mocks.cookie = ""; userId = createUser(db, "fixture@example.test", "Fixture", "unused").id; workspaceId = createWorkspace(db, userId, "Company").id; });
afterEach(() => { db.close(); });

describe("workspace session cookie", () => {
  it("binds a session to a real membership and revokes it on logout", async () => {
    await createSession(userId, workspaceId);
    const session = (await readSession())!;
    expect(session).toMatchObject({ userId, workspaceId });
    const stolenCookie = mocks.cookie;
    await destroySession();
    expect(validWorkspaceSession(db, userId, workspaceId, session.sessionId)).toBe(false);
    mocks.cookie = stolenCookie;
    expect(await readSession()).toBeNull();
  });
  it("rotates the server session when switching workspaces", async () => {
    await createSession(userId, workspaceId);
    const previous = (await readSession())!, second = createWorkspace(db, userId, "Second");
    await createSession(userId, second.id);
    expect(await readSession()).toMatchObject({ userId, workspaceId: second.id });
    expect(validWorkspaceSession(db, userId, workspaceId, previous.sessionId)).toBe(false);
  });
  it("rejects missing membership even with a previously valid cookie", async () => {
    await createSession(userId, workspaceId);
    db.prepare("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?").run(workspaceId, userId);
    expect(await readSession()).toBeNull();
  });
  it("rejects a signed old cookie that has no revocable server session", async () => {
    mocks.cookie = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(config.sessionSecret));
    expect(await readSession()).toBeNull();
  });
  it("refuses to create a session for another company's workspace", async () => {
    const other = createUser(db, "other@example.test", "Other", "unused"), foreign = createWorkspace(db, other.id, "Private");
    await expect(createSession(userId, foreign.id)).rejects.toThrow("belong");
    expect(await readSession()).toBeNull();
  });
});
