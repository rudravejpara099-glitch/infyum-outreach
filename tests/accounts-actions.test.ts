import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { connectAccount, reopenLogin } from "@/app/(app)/accounts/actions";

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

describe("Instagram sign-in actions", () => {
  it("opens a login-only process without requiring the full worker", async () => {
    const form = new FormData(); form.set("handle", "@review.account"); form.set("dailyCap", "20");
    const result = await connectAccount(form);
    const account = db.prepare("SELECT id FROM ig_accounts").get() as { id: number };
    const job = db.prepare("SELECT id,status FROM jobs WHERE type='open_login'").get() as { id: number; status: string };
    expect(result.message).toMatch(/opening in a separate window/i);
    expect(job.status).toBe("running");
    expect(spawn).toHaveBeenCalledWith(process.execPath, ["--import", "tsx", expect.stringContaining("open-instagram-login.ts"), String(account.id), String(job.id)], expect.objectContaining({ detached: true, stdio: "ignore", env: expect.not.objectContaining({ APIFY_TOKEN: expect.anything() }) }));
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
});
