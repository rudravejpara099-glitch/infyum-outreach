import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount, getAccount, setAccountStatus } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { openLoginWindowJob } from "@/lib/services/login-window-job";

let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());

describe("login-only job", () => {
  it("opens only its sign-in window and leaves campaign work queued", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    const loginId = enqueue(db, { type: "open_login", accountId: account.id });
    enqueue(db, { type: "warmup", leadId: null, accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(loginId);
    const openLogin = vi.fn(async () => true);

    await openLoginWindowJob(db, loginId, account.id, { openLogin });

    expect(openLogin).toHaveBeenCalledOnce();
    expect(JSON.parse((db.prepare("SELECT payload FROM jobs WHERE id=?").get(loginId) as { payload: string }).payload)).toEqual({ authenticated: true });
    expect(db.prepare("SELECT type,status FROM jobs ORDER BY id").all()).toEqual([
      { type: "open_login", status: "done" }, { type: "warmup", status: "queued" },
    ]);
    expect(db.prepare("SELECT count(*) n FROM messages WHERE direction='out' AND status='sent'").get()).toEqual({ n: 0 });
  });

  it("records an incomplete sign-in without claiming the account is connected", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    const id = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);
    await openLoginWindowJob(db, id, account.id, { openLogin: vi.fn(async () => false) });
    const job = db.prepare("SELECT status,payload FROM jobs WHERE id=?").get(id) as { status: string; payload: string };
    expect(job.status).toBe("done");
    expect(JSON.parse(job.payload)).toEqual({ authenticated: false });
  });

  it("reactivates an account stopped only for missing sign-in after the check verifies sign-in", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    setAccountStatus(db, account.id, "blocked", "The saved Instagram account is not signed in in Chrome.", "worker");
    const id = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);

    await openLoginWindowJob(db, id, account.id, { openLogin: vi.fn(async () => true) });

    expect(getAccount(db, account.id)).toMatchObject({ status: "active", statusNote: "" });
    expect(db.prepare("SELECT status FROM jobs WHERE id=?").get(id)).toEqual({ status: "done" });
    expect(db.prepare("SELECT action,detail FROM activity WHERE account_id=? ORDER BY id DESC LIMIT 1").get(account.id)).toEqual({ action: "account.active", detail: "" });
  });

  it("never clears an Instagram warning after a successful sign-in check", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    setAccountStatus(db, account.id, "blocked", "Instagram showed a warning or a human check. Review the account in Chrome.", "worker");
    const id = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);

    await openLoginWindowJob(db, id, account.id, { openLogin: vi.fn(async () => true) });

    expect(getAccount(db, account.id)).toMatchObject({ status: "blocked", statusNote: "Instagram showed a warning or a human check. Review the account in Chrome." });
  });

  it("fails the login check when Chrome itself returns an error", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    const id = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);

    await expect(openLoginWindowJob(db, id, account.id, { openLogin: vi.fn(async () => { throw new Error("Chrome could not verify the Instagram sign-in state."); }) }))
      .rejects.toThrow("The sign-in check could not finish.");
    const job = db.prepare("SELECT status,payload FROM jobs WHERE id=?").get(id) as { status: string; payload: string };
    expect(job.status).toBe("failed");
    expect(JSON.parse(job.payload)).toEqual({});
  });

  it("refuses to run a non-login job", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    const id = enqueue(db, { type: "warmup", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);
    const openLogin = vi.fn(async () => true);
    await expect(openLoginWindowJob(db, id, account.id, { openLogin })).rejects.toThrow("no longer available");
    expect(openLogin).not.toHaveBeenCalled();
  });
});
