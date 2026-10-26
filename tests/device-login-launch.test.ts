import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
const state = vi.hoisted(() => ({ spawn: vi.fn(), paths: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: state.spawn }));
vi.mock("@/lib/workspaces/storage", () => ({ getWorkspacePaths: state.paths }));
import { launchDeviceLogin } from "@/lib/connectors/start-login";
let db: Db, accountId: number, jobId: number;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("OUTREACH_SMOKE_MODE", "0"); db = openDb(":memory:");
  state.paths.mockReturnValue({ dbPath: "/private-company/outreach.db", profilesDir: "/private-company/profiles" });
  accountId = createAccount(db, { handle: "mycompany", profileDir: "/private-company/profiles/mycompany" }, "test").id;
  jobId = enqueue(db, { type: "open_login", accountId }); db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(jobId);
  state.spawn.mockReturnValue({ pid: 201, once: vi.fn(), unref: vi.fn() });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
describe("customer device sign-in process", () => {
  it("passes only the company paths and required runtime environment, never host secrets or Chrome", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "owner-api-secret"); vi.stubEnv("STRIPE_SECRET_KEY", "owner-payment-secret"); vi.stubEnv("SESSION_SECRET", "owner-session-secret"); vi.stubEnv("OUTREACH_HOST_CHROME_ALLOWED", "1");
    expect(launchDeviceLogin(db, "private-company", accountId, jobId)).toBe(true);
    const [command, args, options] = state.spawn.mock.calls[0];
    expect(command).toBe(process.execPath); expect(args).toEqual(["--import", "tsx", expect.stringMatching(/scripts\/open-instagram-login.ts$/), String(accountId), String(jobId)]);
    expect(options).toMatchObject({ detached: true, stdio: "ignore", env: { DB_PATH: "/private-company/outreach.db", PROFILES_DIR: "/private-company/profiles", OUTREACH_HOST_CHROME_ALLOWED: "0" } });
    expect(Object.keys(options.env).sort()).toEqual(["DB_PATH", "HOME", "NODE_ENV", "OUTREACH_HOST_CHROME_ALLOWED", "PATH", "PROFILES_DIR", "ANTHROPIC_API_KEY", "APIFY_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "BILLING_OWNER_USER_ID", "SESSION_SECRET"].sort());
    for (const key of ["ANTHROPIC_API_KEY", "APIFY_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "BILLING_OWNER_USER_ID", "SESSION_SECRET"]) expect(options.env[key]).toBe("");
    expect(JSON.stringify(options.env)).not.toMatch(/owner-api-secret|owner-payment-secret|owner-session-secret/);
  });
  it("refuses an unclaimed, foreign-account or non-sign-in job before spawning", () => {
    expect(launchDeviceLogin(db, "private-company", accountId + 1, jobId)).toBe(false);
    db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(jobId); expect(launchDeviceLogin(db, "private-company", accountId, jobId)).toBe(false);
    db.prepare("UPDATE jobs SET status='running',type='check_inbox' WHERE id=?").run(jobId); expect(launchDeviceLogin(db, "private-company", accountId, jobId)).toBe(false);
    expect(state.spawn).not.toHaveBeenCalled();
  });
  it("reports synchronous launch failure without throwing", () => {
    state.spawn.mockImplementation(() => { throw new Error("cannot start"); }); expect(launchDeviceLogin(db, "private-company", accountId, jobId)).toBe(false);
  });
  it("marks asynchronous spawn failure on only its running sign-in request", () => {
    let errorHandler: (() => void) | undefined;
    state.spawn.mockReturnValue({ pid: 202, once: vi.fn((_event, callback) => { errorHandler = callback; }), unref: vi.fn() });
    expect(launchDeviceLogin(db, "private-company", accountId, jobId)).toBe(true); errorHandler!();
    expect(db.prepare("SELECT status,last_error FROM jobs WHERE id=?").get(jobId)).toMatchObject({ status: "failed", last_error: expect.stringContaining("Try again") });
  });
});
