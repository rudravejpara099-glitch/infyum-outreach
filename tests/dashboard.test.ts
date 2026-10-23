import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { createOutgoing, markSent } from "@/lib/db/repos/messages";
import { enqueue } from "@/lib/db/repos/jobs";
import { logActivity, listActivity } from "@/lib/db/repos/activity";
import { dashboardData } from "@/lib/queries/dashboard";

let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());

describe("dashboard counts", () => {
  it("uses the team's local day and last seven local calendar days", () => {
    const account = createAccount(db, { handle: "@sender", profileDir: "/tmp/sender" }, "test");
    const campaign = createCampaign(db, {
      name: "Test", niches: [], audienceText: "", country: "US", minFollowers: 0,
      maxFollowers: 100_000, approvalRequired: false, followupsEnabled: false,
    }, [account.id], "test");
    const addSent = (handle: string, at: string) => {
      const lead = addLead(db, { handle, campaignId: campaign.id }, "test").lead;
      const message = createOutgoing(db, {
        leadId: lead.id, accountId: account.id, kind: "dm", parts: [`Hello ${handle}`], campaign,
      }, "test");
      markSent(db, message.id, new Date(at));
    };
    addSent("today-india", "2026-10-20T19:00:00Z");
    addSent("previous-india-day", "2026-10-20T18:00:00Z");

    const result = dashboardData(db, "2026-10-21", "Asia/Kolkata");
    expect(result.sentToday).toBe(1);
    expect(result.sentWeek).toBe(2);
    expect(result.accounts[0].sentToday).toBe(1);
  });

  it("breaks failed task counts down by type for accurate dashboard guidance", () => {
    enqueue(db, { type: "open_login" });
    enqueue(db, { type: "qualify" });
    db.prepare("UPDATE jobs SET status='failed'").run();

    const result = dashboardData(db, "2026-10-21", "UTC");
    expect(result.failedJobs).toBe(2);
    expect(result.failedJobTypes).toEqual({ open_login: 1, qualify: 1 });
  });

  it("clears old sign-in failures after the same account is verified again", () => {
    const account = createAccount(db, { handle: "@sender", profileDir: "/tmp/sender" }, "test");
    const failedLogin = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(failedLogin);
    const verifiedLogin = enqueue(db, { type: "open_login", accountId: account.id, payload: { authenticated: true } });
    db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(verifiedLogin);
    const latestFailure = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(latestFailure);

    const result = dashboardData(db, "2026-10-21", "UTC");
    expect(result.failedJobs).toBe(1);
    expect(result.failedJobTypes).toEqual({ open_login: 1 });
  });

  it("clears old sign-in failures after a successful inbox check", () => {
    const account = createAccount(db, { handle: "@sender", profileDir: "/tmp/sender" }, "test");
    const failedLogin = enqueue(db, { type: "open_login", accountId: account.id });
    db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(failedLogin);
    const inboxCheck = enqueue(db, { type: "check_inbox", accountId: account.id });
    db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(inboxCheck);

    const result = dashboardData(db, "2026-10-21", "UTC");
    expect(result.failedJobs).toBe(0);
    expect(result.failedJobTypes).toEqual({});
  });

  it("hides resolved inbox failures from Overview but keeps them in History", () => {
    const account = createAccount(db, { handle: "@sender", profileDir: "/tmp/sender" }, "test");
    logActivity(db, "worker", "job.error", { accountId: account.id, detail: "check_inbox: Chrome did not finish connecting." });
    logActivity(db, "worker", "inbox.checked", { accountId: account.id, detail: "Reply check succeeded." });

    const result = dashboardData(db, "2026-10-21", "UTC");
    expect(result.recentActivity.map((event) => event.action)).toEqual(["inbox.checked", "account.connected"]);
    expect(listActivity(db).slice(0, 2).map((event) => event.action)).toEqual(["inbox.checked", "job.error"]);
  });

  it("keeps an inbox failure visible until that account succeeds", () => {
    const account = createAccount(db, { handle: "@sender", profileDir: "/tmp/sender" }, "test");
    const other = createAccount(db, { handle: "@other", profileDir: "/tmp/other" }, "test");
    logActivity(db, "worker", "job.error", { accountId: account.id, detail: "check_inbox: timed out" });
    logActivity(db, "worker", "inbox.checked", { accountId: other.id, detail: "Reply check succeeded." });

    const result = dashboardData(db, "2026-10-21", "UTC");
    expect(result.recentActivity.slice(0, 2).map((event) => event.action)).toEqual(["inbox.checked", "job.error"]);
  });
});
