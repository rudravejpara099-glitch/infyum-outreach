import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { createOutgoing, approveMessage, listMessages, countPendingMessages } from "@/lib/db/repos/messages";
import { campaignOverview } from "@/lib/queries/campaign-overview";

let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());
function campaign(name: string) {
  return createCampaign(db, { name, niches: [], audienceText: "", country: "United States", minFollowers: 2000,
    maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "test");
}
function draft(c: ReturnType<typeof campaign>, handle: string) {
  const { lead } = addLead(db, { handle, campaignId: c.id }, "test");
  return createOutgoing(db, { leadId: lead.id, accountId: null, kind: "dm", parts: ["A specific detail", "An introduction", "A question?"], campaign: c }, "test");
}
it("returns honest zero counts for an empty campaign", () => {
  const c = campaign("Empty");
  expect(campaignOverview(db, c.id)).toMatchObject({ total: 0, pendingCount: 0, pending: [], conversations: 0 });
});
it("scopes the review count and previews to the campaign", () => {
  const a = campaign("A"), b = campaign("B");
  const message = draft(a, "alice"); draft(b, "bob");
  expect(countPendingMessages(db)).toBe(2);
  expect(campaignOverview(db, a.id)).toMatchObject({ total: 1, pendingCount: 1, pending: [{ id: message.id, handle: "alice", partCount: 3 }] });
  expect(listMessages(db, { campaignId: a.id, status: "pending_approval" }).map(m => m.id)).toEqual([message.id]);
});
it("counts all waiting drafts but only previews two, oldest first", () => {
  const c = campaign("Queue");
  for (const handle of ["one", "two", "three"]) draft(c, handle);
  const result = campaignOverview(db, c.id);
  expect(result.pendingCount).toBe(3);
  expect(result.pending.map(m => m.handle)).toEqual(["one", "two"]);
});
it("removes an approved message from the waiting count immediately", () => {
  const c = campaign("Review"); const m = draft(c, "review");
  approveMessage(db, m.id, "test");
  expect(campaignOverview(db, c.id).pendingCount).toBe(0);
});
it("keeps the oldest preview reachable when the approval queue exceeds one page", () => {
  const c = campaign("Backlog");
  const first = draft(c, "oldest");
  for (let index = 0; index < 101; index++) draft(c, `backlog${index}`);
  const queue = listMessages(db, { campaignId: c.id, status: "pending_approval", limit: 100, oldestFirst: true });
  expect(queue[0].id).toBe(first.id);
  expect(queue).toHaveLength(100);
  expect(campaignOverview(db, c.id).pendingCount).toBe(102);
});
it("counts inbox conversations by stage without claiming they are unread", () => {
  const a = campaign("A"), b = campaign("B");
  addLead(db, { handle: "reply", campaignId: a.id, stage: "replied" }, "test");
  addLead(db, { handle: "sent", campaignId: a.id, stage: "dm_sent" }, "test");
  addLead(db, { handle: "other", campaignId: b.id, stage: "replied" }, "test");
  expect(campaignOverview(db, a.id)).toMatchObject({ total: 2, conversations: 1 });
});
