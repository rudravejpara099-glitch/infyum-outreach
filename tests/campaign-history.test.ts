import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { campaignHistory } from "@/lib/queries/campaign-history";
let db: Db;
let campaignId: number, leadId: number;
beforeEach(() => {
  db = openDb(":memory:");
  campaignId = createCampaign(db, { name: "History", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "test").id;
  leadId = addLead(db, { handle: "history", campaignId }, "test").lead.id;
});
afterEach(() => db.close());
function sent(ts: string, kind = "dm", direction = "out", status = "sent", lead = leadId) {
  db.prepare("INSERT INTO messages(lead_id,direction,kind,parts,status,sent_at) VALUES (?,?,?,'[]',?,?)").run(lead, direction, kind, status, ts);
}
function reply(ts: string, action = "lead.handoff") {
  db.prepare("INSERT INTO activity(ts,actor,action,lead_id) VALUES (?,'test',?,?)").run(ts, action, leadId);
}
it("returns fourteen local dates including today with honest zero counts", () => {
  const result = campaignHistory(db, campaignId, "America/New_York", new Date("2026-10-21T02:00:00Z"));
  expect(result).toHaveLength(14);
  expect(result[0].date).toBe("2026-10-07");
  expect(result.at(-1)).toEqual({ date: "2026-10-20", sent: 0, replies: 0 });
});
it("uses local midnight and only sent outreach for this campaign", () => {
  sent("2026-10-21 03:59:59"); sent("2026-10-21T04:00:00Z", "followup");
  sent("2026-10-21 05:00:00", "incoming", "in"); sent("2026-10-21 05:00:00", "reply"); sent("2026-10-21 05:00:00", "dm", "out", "approved");
  const other = addLead(db, { handle: "other", campaignId: null }, "test").lead.id;
  sent("2026-10-21 05:00:00", "dm", "out", "sent", other);
  const result = campaignHistory(db, campaignId, "America/New_York", new Date("2026-10-21T12:00:00Z"));
  expect(result.at(-2)?.sent).toBe(1); expect(result.at(-1)?.sent).toBe(1);
});
it("counts first handoff once and excludes automatic replies and repeated inbox reads", () => {
  reply("2026-10-20 15:00:00", "message.auto_reply_ignored");
  reply("2026-10-20 16:00:00"); reply("2026-10-21 16:00:00");
  const result = campaignHistory(db, campaignId, "UTC", new Date("2026-10-21T22:00:00Z"));
  expect(result.at(-2)?.replies).toBe(1); expect(result.at(-1)?.replies).toBe(0);
});
it("does not count an older first reply again in the visible window", () => {
  reply("2026-09-01 12:00:00"); reply("2026-10-21 12:00:00");
  expect(campaignHistory(db, campaignId, "UTC", new Date("2026-10-21T22:00:00Z")).reduce((sum, day) => sum + day.replies, 0)).toBe(0);
});
it("keeps every calendar date across DST and supports positive-offset zones", () => {
  sent("2026-11-01 05:30:00"); sent("2026-11-01 06:30:00");
  expect(campaignHistory(db, campaignId, "America/New_York", new Date("2026-11-01T22:00:00Z")).at(-1)?.sent).toBe(2);
  sent("2026-11-01 18:31:00");
  const result = campaignHistory(db, campaignId, "Asia/Kolkata", new Date("2026-11-01T20:00:00Z"));
  expect(new Set(result.map(day => day.date)).size).toBe(14);
  expect(result.at(-1)).toMatchObject({ date: "2026-11-02", sent: 1 });
});
