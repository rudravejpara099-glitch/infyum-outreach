import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount, getAccount } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import { connectAccount, reopenLogin, useSeparateSignIn, useSignedInChrome } from "@/app/(app)/accounts/actions";

const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ id: 1, email: "test@example.test" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => ({ pid: 42, once: () => {}, unref: () => {} })) }));
import { spawn } from "node:child_process";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:"); state.db = db;
  delete process.env.OUTREACH_SMOKE_MODE;
  vi.clearAllMocks();
});
afterEach(() => { db.close(); state.db = null; delete process.env.OUTREACH_SMOKE_MODE; });

function setWorkerPhase(phase: "unresponsive" | "stopping"): void {
  const leasePhase = phase === "unresponsive" ? "running" : "stopping";
  const updatedAt = new Date(Date.now() - (phase === "unresponsive" ? 120_000 : 0)).toISOString();
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('worker_control',?)")
    .run(JSON.stringify({ token: "live-worker", pid: process.pid, phase: leasePhase, updatedAt }));
}

function expectQueuedWithoutSecondProcess(): void {
  expect(spawn).not.toHaveBeenCalled();
  expect(db.prepare("SELECT status FROM jobs WHERE type='open_login'").get()).toEqual({ status: "queued" });
}

describe("Instagram sign-in actions", () => {
  it("opens a login-only process without requiring the full worker", async () => {
    db.prepare("INSERT INTO settings (key,value) VALUES ('team_timezone','Asia/Kolkata')").run();
    const form = new FormData(); form.set("handle", "@review.account"); form.set("dailyCap", "20");
    const result = await connectAccount(form);
    const account = db.prepare("SELECT id,ramp_start FROM ig_accounts").get() as { id: number; ramp_start: string };
    const job = db.prepare("SELECT id,status FROM jobs WHERE type='open_login'").get() as { id: number; status: string };
    expect(result.message).toMatch(/separate sign-in window/i);
    expect(account.ramp_start).toBe(dateInTimeZone(new Date(), "Asia/Kolkata"));
    expect(job.status).toBe("running");
    expect(spawn).toHaveBeenCalledWith(process.execPath, ["--import", "tsx", expect.stringContaining("open-instagram-login.ts"), String(account.id), String(job.id)], expect.objectContaining({ detached: true, stdio: "ignore", env: expect.not.objectContaining({ APIFY_TOKEN: expect.anything() }) }));
  });

  it("describes signed-in Chrome as a check, not a new login window", async () => {
    const form = new FormData(); form.set("handle", "@chrome.account"); form.set("dailyCap", "20"); form.set("browserMode", "chrome_read_only");
    const result = await connectAccount(form);
    expect(result.message).toBe("Account saved. Outreach is checking the current Chrome sign-in.");
    expect(result.message).not.toMatch(/separate window/i);
    expect(db.prepare("SELECT browser_mode FROM ig_accounts WHERE handle='chrome.account'").get()).toEqual({ browser_mode: "chrome_read_only" });
  });

  it("does not start a duplicate window while a sign-in request is active", async () => {
    const account = createAccount(db, { handle: "review.account", profileDir: "/tmp/review.account", dailyCap: 20 }, "test");
    const jobId = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(jobId);
    const form = new FormData(); form.set("id", String(account.id));

    const result = await reopenLogin(form);

    expect(result.message).toMatch(/already opening/i);
    expect(spawn).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='open_login'").get()).toEqual({ n: 1 });
  });

  it("lets an existing account opt into signed-in Chrome and switch back", async () => {
    const account = createAccount(db, { handle: "review.account", profileDir: "/tmp/review.account" }, "test");
    const form = new FormData(); form.set("id", String(account.id));
    const result = await useSignedInChrome(form);
    expect(result.message).toMatch(/campaign messages still require approval/i);
    expect(getAccount(db, account.id)?.browserMode).toBe("chrome_read_only");
    expect(spawn).toHaveBeenCalledTimes(1);

    const switched = await useSeparateSignIn(form);
    expect(switched.message).toMatch(/separate sign-in window/i);
    expect(getAccount(db, account.id)?.browserMode).toBe("isolated");
  });

  it.each(["unresponsive", "stopping"] as const)("does not start a duplicate login process when the worker is %s", async (phase) => {
    setWorkerPhase(phase);
    const form = new FormData(); form.set("handle", `@waiting.${phase}`); form.set("dailyCap", "20");

    const result = await connectAccount(form);

    expect(result.message).toMatch(/saved/i);
    expect(result.message).toMatch(phase === "unresponsive" ? /rather than opening another sign-in window/i : /after Outreach starts again/i);
    expectQueuedWithoutSecondProcess();
  });

  it.each(["unresponsive", "stopping"] as const)("queues signed-in Chrome checks while the worker is %s", async (phase) => {
    setWorkerPhase(phase);
    const account = createAccount(db, { handle: `chrome.${phase}`, profileDir: `/tmp/chrome.${phase}` }, "test");
    const form = new FormData(); form.set("id", String(account.id));

    const result = await useSignedInChrome(form);

    expect(result.message).toMatch(/saved/i);
    expect(result.message).toMatch(phase === "unresponsive" ? /rather than opening another sign-in window/i : /after Outreach starts again/i);
    expectQueuedWithoutSecondProcess();
  });

  it.each(["unresponsive", "stopping"] as const)("queues a repeated sign-in check while the worker is %s", async (phase) => {
    setWorkerPhase(phase);
    const account = createAccount(db, { handle: `retry.${phase}`, profileDir: `/tmp/retry.${phase}` }, "test");
    const form = new FormData(); form.set("id", String(account.id));

    const result = await reopenLogin(form);

    expect(result.message).toMatch(/saved/i);
    expect(result.message).toMatch(phase === "unresponsive" ? /rather than opening another sign-in window/i : /after Outreach starts again/i);
    expectQueuedWithoutSecondProcess();
  });
});
