import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { createOutgoing, markSent } from "@/lib/db/repos/messages";
import { enqueue } from "@/lib/db/repos/jobs";
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
});
