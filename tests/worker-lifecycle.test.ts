import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount, setAccountStatus } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { adoptWorker, failWorkerLaunch, heartbeatWorker, releaseWorker, requestWorkerStop, reserveWorker, workerControl, workerMayClaim } from "@/lib/services/worker-lifecycle";
import { claimNext, enqueue } from "@/lib/db/repos/jobs";
import { workerStartProblem } from "@/lib/services/worker-start-readiness";

let db: Db;
const now = new Date("2026-10-22T10:00:00.000Z");
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => { db.close(); });

describe("local worker ownership", () => {
  it("reserves once, adopts only the owner and drains on stop", () => {
    const first = reserveWorker(db, now)!;
    expect(first).toBeTruthy();
    expect(reserveWorker(db, now)).toBeNull();
    expect(adoptWorker(db, "wrong-owner", process.pid, now)).toBe(false);
    expect(adoptWorker(db, first, process.pid, now)).toBe(true);
    expect(heartbeatWorker(db, first, process.pid, now)).toBe("running");
    expect(requestWorkerStop(db, now)).toBe("stopping");
    expect(heartbeatWorker(db, first, process.pid, now)).toBe("stopping");
    expect(reserveWorker(db, now)).toBeNull();
    releaseWorker(db, "wrong-owner", process.pid, now);
    expect(workerControl(db, now).phase).toBe("stopping");
    releaseWorker(db, first, process.pid, now);
    expect(workerControl(db, now).phase).toBe("stopped");
    expect(reserveWorker(db, now)).toBeTruthy();
  });

  it("refuses a new job claim after Stop commits", () => {
    const token = reserveWorker(db, now)!;
    expect(adoptWorker(db, token, process.pid, now)).toBe(true);
    enqueue(db, { type: "check_inbox" });
    requestWorkerStop(db, now);
    expect(claimNext(db, undefined, undefined, () => workerMayClaim(db, token, process.pid))).toBeNull();
    expect(db.prepare("SELECT status FROM jobs LIMIT 1").get()).toEqual({ status: "queued" });
  });

  it("does not replace a live but silent worker", () => {
    const token = reserveWorker(db, now)!;
    expect(adoptWorker(db, token, process.pid, now)).toBe(true);
    const later = new Date(now.getTime() + 120_000);
    expect(workerControl(db, later).phase).toBe("unresponsive");
    expect(reserveWorker(db, later)).toBeNull();
    const replacement = reserveWorker(db, later, () => false);
    expect(replacement).toBeTruthy();
    expect(heartbeatWorker(db, token, process.pid, later)).toBeNull();
    releaseWorker(db, token, process.pid, later);
    expect(adoptWorker(db, replacement!, process.pid, later)).toBe(true);
  });

  it("expires an unadopted start and fences a late child", () => {
    const oldToken = reserveWorker(db, now)!;
    const later = new Date(now.getTime() + 31_000);
    const newToken = reserveWorker(db, later)!;
    expect(newToken).toBeTruthy();
    expect(adoptWorker(db, oldToken, process.pid, later)).toBe(false);
    failWorkerLaunch(db, oldToken, later);
    expect(workerControl(db, later).phase).toBe("starting");
    expect(requestWorkerStop(db, later)).toBe("stopped");
    expect(adoptWorker(db, newToken, process.pid, later)).toBe(false);
  });
});

describe("worker Start readiness", () => {
  it("allows an active signed-in Chrome sender and refuses a paused sender", () => {
    const account = createAccount(db, { handle: "sender", profileDir: "/tmp/sender", browserMode: "chrome_read_only" }, "test");
    const campaign = createCampaign(db, { name: "Test campaign", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [account.id], "test");
    setCampaignStatus(db, campaign.id, "active", "test");
    expect(workerStartProblem(db)).toBeNull();
    setAccountStatus(db, account.id, "paused", "", "test");
    expect(workerStartProblem(db)).toMatch(/active Instagram account/);
    setAccountStatus(db, account.id, "active", "", "test");
    expect(workerStartProblem(db)).toBeNull();
  });
});
