import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
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
    const openLogin = vi.fn(async () => {});

    await openLoginWindowJob(db, loginId, account.id, { openLogin });

    expect(openLogin).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT type,status FROM jobs ORDER BY id").all()).toEqual([
      { type: "open_login", status: "done" }, { type: "warmup", status: "queued" },
    ]);
    expect(db.prepare("SELECT count(*) n FROM messages WHERE direction='out' AND status='sent'").get()).toEqual({ n: 0 });
  });

  it("refuses to run a non-login job", async () => {
    const account = createAccount(db, { handle: "owner", profileDir: "/tmp/owner", dailyCap: 35 }, "test");
    const id = enqueue(db, { type: "warmup", accountId: account.id });
    db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);
    const openLogin = vi.fn(async () => {});
    await expect(openLoginWindowJob(db, id, account.id, { openLogin })).rejects.toThrow("no longer available");
    expect(openLogin).not.toHaveBeenCalled();
  });
});
