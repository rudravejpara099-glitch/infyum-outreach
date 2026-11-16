import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createUser, countUsers, findUserByEmail } from "@/lib/db/repos/users";
import { listWorkspaces } from "@/lib/workspaces/catalog";
import { hashPassword } from "@/lib/auth/password";
import { REGISTRATION_CLOSED_MESSAGE, registrationOpen } from "@/lib/auth/registration";

const mocks = vi.hoisted(() => ({ identity: null as unknown, operational: null as unknown, session: vi.fn(), guard: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspaces/storage", () => ({ getIdentityDb: () => mocks.identity, getWorkspaceDb: () => mocks.operational }));
vi.mock("@/lib/auth/session", () => ({ createSession: mocks.session, destroySession: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: mocks.guard }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { register } from "@/app/register/actions";
import { login } from "@/app/login/actions";

let db: Db, operational: Db;
const form = (data: Record<string, string>) => { const result = new FormData(); for (const [key, value] of Object.entries(data)) result.set(key, value); return result; };
const credentials = { name: "Stranger", email: "stranger@example.test", password: "fixture-password", workspaceName: "Stranger Co" };
beforeEach(() => { db = openDb(":memory:"); operational = openDb(":memory:"); mocks.identity = db; mocks.operational = operational; vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); db.close(); operational.close(); });

describe("registrationOpen", () => {
  it("is closed unless explicitly turned on", () => {
    expect(registrationOpen({})).toBe(false);
    expect(registrationOpen({ ALLOW_REGISTRATION: "" })).toBe(false);
    expect(registrationOpen({ ALLOW_REGISTRATION: "false" })).toBe(false);
    expect(registrationOpen({ ALLOW_REGISTRATION: "0" })).toBe(false);
    expect(registrationOpen({ ALLOW_REGISTRATION: "maybe" })).toBe(false);
  });
  it("opens for true, 1, yes or on in any case, ignoring spaces", () => {
    for (const value of ["true", "TRUE", "1", "yes", "on", " true "]) expect(registrationOpen({ ALLOW_REGISTRATION: value }), value).toBe(true);
  });
  it("reads the real environment by default", () => {
    vi.stubEnv("ALLOW_REGISTRATION", "true");
    expect(registrationOpen()).toBe(true);
    vi.stubEnv("ALLOW_REGISTRATION", "");
    expect(registrationOpen()).toBe(false);
  });
});

describe("register action while sign-up is closed (the default)", () => {
  it("refuses a stranger and creates nothing", async () => {
    vi.stubEnv("ALLOW_REGISTRATION", "");
    const result = await register(undefined, form(credentials));
    expect(result?.error).toBe(REGISTRATION_CLOSED_MESSAGE);
    expect(countUsers(db)).toBe(0);
    expect(findUserByEmail(db, credentials.email)).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("does not reveal whether an email is already registered", async () => {
    vi.stubEnv("ALLOW_REGISTRATION", "");
    createUser(db, credentials.email, "Existing", hashPassword("original-password"));
    const known = await register(undefined, form(credentials));
    const unknown = await register(undefined, form({ ...credentials, email: "nobody@example.test" }));
    expect(known).toEqual(unknown);
  });
  it("refuses even a valid existing login from creating another workspace", async () => {
    vi.stubEnv("ALLOW_REGISTRATION", "");
    const user = createUser(db, credentials.email, "Existing", hashPassword(credentials.password));
    expect((await register(undefined, form(credentials)))?.error).toBe(REGISTRATION_CLOSED_MESSAGE);
    expect(listWorkspaces(db, user.id)).toHaveLength(0);
  });
  it("sends a member who lost their team to an invitation, not to the closed page", async () => {
    vi.stubEnv("ALLOW_REGISTRATION", "");
    createUser(db, credentials.email, "Existing", hashPassword(credentials.password));
    const result = await login(undefined, form({ email: credentials.email, password: credentials.password }));
    expect(result?.error).toContain("invitation");
    expect(result?.error).not.toContain("Create a private workspace");
  });
});

describe("register action once the owner turns sign-up on", () => {
  it("works as before", async () => {
    vi.stubEnv("ALLOW_REGISTRATION", "true");
    await expect(register(undefined, form(credentials))).rejects.toThrow("redirect:/");
    expect(countUsers(db)).toBe(1);
  });
});
