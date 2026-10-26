import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { workerControl } from "@/lib/services/worker-lifecycle";
import { startWorker, stopWorker } from "@/app/(app)/worker/actions";

const state = vi.hoisted(() => ({ db: null as Db | null, hostChromeAllowed: true, workspaceId: "legacy", local: true as boolean }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ id: 1, email: "owner@example.test", workspaceId: state.workspaceId, hostChromeAllowed: state.hostChromeAllowed })) }));
vi.mock("@/lib/workspaces/storage", () => ({ getWorkspacePaths: () => ({ dbPath: "/tmp/tenant.db", profilesDir: "/tmp/tenant-profiles", hostChromeAllowed: state.hostChromeAllowed }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/request-origin", () => ({ requestIsFromThisComputer: vi.fn(async () => state.local ?? true) }));
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => ({ pid: 999999, once: vi.fn(), unref: vi.fn() })) }));
import { spawn } from "node:child_process";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:"); state.db = db; state.hostChromeAllowed = true; state.workspaceId = "legacy";
  vi.clearAllMocks();
  delete process.env.VERCEL;
  delete process.env.OUTREACH_SMOKE_MODE;
});
afterEach(() => { db.close(); state.db = null; vi.unstubAllEnvs(); });

describe("local background service actions", () => {
  it("launches a private-company worker with that company's storage and no host Chrome", async () => {
    state.hostChromeAllowed = false; state.workspaceId = "private-company";
    for (const key of ["ANTHROPIC_API_KEY", "APIFY_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "BILLING_OWNER_USER_ID", "SESSION_SECRET"]) vi.stubEnv(key, "fixture-owner-secret");
    expect((await startWorker()).message).toMatch(/starting/);
    expect(spawn).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({ env: expect.objectContaining({ DB_PATH: "/tmp/tenant.db", PROFILES_DIR: "/tmp/tenant-profiles", OUTREACH_HOST_CHROME_ALLOWED: "0", ANTHROPIC_API_KEY: "", APIFY_TOKEN: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", BILLING_OWNER_USER_ID: "", SESSION_SECRET: "" }) }));
  });

  it("refuses to start or stop processes on this computer from the public address", async () => {
    state.local = false;
    try {
      expect((await startWorker()).error).toMatch(/this computer/);
      expect((await stopWorker()).error).toMatch(/this computer/);
      expect(spawn).not.toHaveBeenCalled();
    } finally { state.local = true; }
  });

  it("requires an explicit Start and launches only one child", async () => {
    expect(spawn).not.toHaveBeenCalled();
    expect((await startWorker()).message).toMatch(/starting/);
    expect(workerControl(db).phase).toBe("starting");
    expect(spawn).toHaveBeenCalledWith(process.execPath, ["--import", "tsx", expect.stringContaining("worker/index.ts")], expect.objectContaining({ detached: true, stdio: ["ignore", expect.any(Number), expect.any(Number)], env: expect.objectContaining({ DB_PATH: expect.any(String), OUTREACH_WORKER_LEASE_TOKEN: expect.any(String) }) }));
    expect((await startWorker()).message).toMatch(/already starting/);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect((await stopWorker()).message).toMatch(/stopped/);
    expect(workerControl(db).phase).toBe("stopped");
  });

  it("refuses an active campaign with no selected usable sender", async () => {
    const campaign = createCampaign(db, { name: "Review", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "test");
    setCampaignStatus(db, campaign.id, "active", "test");
    expect((await startWorker()).error).toMatch(/needs a selected/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("never launches a local child from hosted or smoke runtime", async () => {
    process.env.VERCEL = "1";
    expect((await startWorker()).error).toMatch(/local app/);
    delete process.env.VERCEL;
    process.env.OUTREACH_SMOKE_MODE = "1";
    expect((await startWorker()).error).toMatch(/local app/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
