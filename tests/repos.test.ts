import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { addLead, getLead, moveStage, dueFollowups, countByStage } from "@/lib/db/repos/leads";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { createAccount } from "@/lib/db/repos/accounts";
import { createOutgoing, approveMessage, listMessages, sentTodayForAccount, recentSentTexts } from "@/lib/db/repos/messages";
import { claimNext, enqueue, failJob, completeJob, requeueStuck } from "@/lib/db/repos/jobs";
import { isDnc } from "@/lib/db/repos/dnc";
import { afterSent, handleIncoming, markDoNotContact } from "@/lib/services/outreach";
import { listActivity } from "@/lib/db/repos/activity";

let db: Db;
const campaignInput = {
  name: "Credit repair US", niches: ["credit repair"], audienceText: "", country: "United States",
  minFollowers: 2000, maxFollowers: 150000, approvalRequired: false, followupsEnabled: true,
};
const seed = (approvalRequired = false) => {
  const acct = createAccount(db, { handle: "@Sender", profileDir: "/tmp/p" }, "t");
  const camp = createCampaign(db, { ...campaignInput, approvalRequired }, [acct.id], "t");
  const { lead } = addLead(db, { handle: "@Target", campaignId: camp.id, followers: 5000 }, "t");
  return { acct, camp, lead };
};

beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());

describe("leads", () => {
  it("dedupes by handle, ignoring @ and case", () => {
    const a = addLead(db, { handle: "@Foo" }, "t");
    const b = addLead(db, { handle: "foo" }, "t");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.lead.id).toBe(a.lead.id);
  });
  it("refuses illegal stage jumps and logs legal ones", () => {
    const { lead } = addLead(db, { handle: "x" }, "t");
    expect(() => moveStage(db, lead.id, "dm_sent", "t")).toThrow();
    moveStage(db, lead.id, "qualified", "t");
    expect(getLead(db, lead.id)!.stage).toBe("qualified");
    expect(listActivity(db).some((a) => a.action === "lead.qualified")).toBe(true);
  });
  it("records why a lead was skipped", () => {
    const { lead } = addLead(db, { handle: "y" }, "t");
    moveStage(db, lead.id, "skipped", "t", "Based in India");
    expect(getLead(db, lead.id)!.skipReason).toBe("Based in India");
    expect(countByStage(db).skipped).toBe(1);
  });
});

it("checks an account inbox before its queued send", () => {
  const { acct } = seed(true);
  enqueue(db, { type: "send", accountId: acct.id, payload: { messageId: 1 } });
  enqueue(db, { type: "check_inbox", accountId: acct.id });
  expect(claimNext(db, undefined, { accountId: acct.id })?.type).toBe("check_inbox");
});

describe("messages and approval", () => {
  it("auto-approves when the campaign allows and the text is clean", () => {
    const { acct, camp, lead } = seed(false);
    const m = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["Nice reel.", "I'm Rudra.", "Quick question?"], campaign: camp }, "t");
    expect(m.status).toBe("approved");
  });
  it("holds everything for approval when the campaign requires it, then releases on approve", () => {
    const { acct, camp, lead } = seed(true);
    const m = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["Hello there"], campaign: camp }, "t");
    expect(m.status).toBe("pending_approval");
    approveMessage(db, m.id, "me@x.com", ["Hello there, edited"]);
    expect(listMessages(db, { leadId: lead.id })[0]).toMatchObject({ status: "approved", parts: ["Hello there, edited"] });
  });
  it("holds a price question even when approval is off", () => {
    const { acct, camp, lead } = seed(false);
    const m = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "reply", parts: ["It depends."], campaign: camp, incomingText: "How much is it?" }, "t");
    expect(m.status).toBe("pending_approval");
  });
  it("flags a message that copies a recent one", () => {
    const { acct, camp, lead } = seed(false);
    moveStage(db, lead.id, "qualified", "t"); moveStage(db, lead.id, "warmed", "t");
    const first = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["Your score jump reels are the kind people save and send around"], campaign: camp }, "t");
    afterSent(db, first.id);
    expect(recentSentTexts(db)).toHaveLength(1);
    const { lead: l2 } = addLead(db, { handle: "other" }, "t");
    const again = createOutgoing(db, { leadId: l2.id, accountId: acct.id, kind: "dm", parts: ["Your score jump reels are the kind people save and send around too"], campaign: camp }, "t");
    expect(again.status).toBe("pending_approval");
  });
});

describe("sending flow", () => {
  it("moves the lead to dm_sent, schedules a follow-up and counts toward today's limit", () => {
    const { acct, camp, lead } = seed(false);
    moveStage(db, lead.id, "qualified", "t"); moveStage(db, lead.id, "warmed", "t");
    const m = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["a", "b", "c"], campaign: camp }, "t");
    afterSent(db, m.id, new Date("2026-10-20T10:00:00Z"));
    const l = getLead(db, lead.id)!;
    expect(l.stage).toBe("dm_sent");
    expect(l.nextFollowupAt).toBe("2026-10-22 10:00:00");
    expect(sentTodayForAccount(db, acct.id, "2026-10-20")).toBe(1);
    expect(dueFollowups(db, "2026-10-22 10:00:01")).toHaveLength(1);
  });
  it("stops follow-ups after two", () => {
    const { acct, camp, lead } = seed(false);
    moveStage(db, lead.id, "qualified", "t"); moveStage(db, lead.id, "warmed", "t");
    afterSent(db, createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["first one alpha beta gamma"], campaign: camp }, "t").id);
    afterSent(db, createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "followup", parts: ["second delta epsilon zeta eta"], campaign: camp }, "t").id);
    expect(getLead(db, lead.id)!.nextFollowupAt).not.toBeNull();
    afterSent(db, createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "followup", parts: ["third theta iota kappa lambda"], campaign: camp }, "t").id);
    expect(getLead(db, lead.id)).toMatchObject({ followupsSent: 2, nextFollowupAt: null });
  });
});

describe("incoming messages", () => {
  const toDmSent = () => {
    const s = seed(false);
    moveStage(db, s.lead.id, "qualified", "t"); moveStage(db, s.lead.id, "warmed", "t");
    afterSent(db, createOutgoing(db, { leadId: s.lead.id, accountId: s.acct.id, kind: "dm", parts: ["hello"], campaign: s.camp }, "t").id);
    return s;
  };
  it("ignores automatic replies", () => {
    const { lead } = toDmSent();
    expect(handleIncoming(db, lead.id, "Hi, thanks for contacting us. We've received your message.").counted).toBe(false);
    expect(getLead(db, lead.id)!.stage).toBe("dm_sent");
  });
  it("a real reply moves the lead, stops follow-ups and hands off without drafting", () => {
    const { lead } = toDmSent();
    expect(handleIncoming(db, lead.id, "Interesting, what do you do exactly?").counted).toBe(true);
    expect(getLead(db, lead.id)).toMatchObject({ stage: "replied", nextFollowupAt: null });
    expect(claimNext(db)).toBeNull();
  });
  it("hands off when a prospect writes before our first DM", () => {
    const { lead } = seed(true);
    expect(handleIncoming(db, lead.id, "Please tell me about your service").counted).toBe(true);
    expect(getLead(db, lead.id)?.stage).toBe("replied");
    expect(handleIncoming(db, lead.id, "Another question").counted).toBe(false);
  });
  it("counts the first real reply once across repeated inbox checks", () => {
    const { lead } = toDmSent();
    const first = "Interesting, what do you do exactly?";
    expect(handleIncoming(db, lead.id, first).counted).toBe(true);
    expect(handleIncoming(db, lead.id, first).counted).toBe(false);
    expect(handleIncoming(db, lead.id, "Another message after hand-off").counted).toBe(false);
    const activity = listActivity(db, { leadId: lead.id });
    expect(activity.filter((row) => row.action === "lead.handoff")).toHaveLength(1);
    expect(activity.filter((row) => row.action === "message.received")).toHaveLength(1);
    expect(listMessages(db, { leadId: lead.id }).filter((message) => message.direction === "in")).toHaveLength(1);
    expect(listMessages(db, { leadId: lead.id }).filter((message) => message.kind === "reply")).toHaveLength(0);
  });
  it("deduplicates automatic replies and waits for a real person", () => {
    const { lead } = toDmSent();
    const automatic = "Hi, thanks for contacting us. We've received your message.";
    expect(handleIncoming(db, lead.id, automatic).counted).toBe(false);
    expect(handleIncoming(db, lead.id, automatic).counted).toBe(false);
    expect(getLead(db, lead.id)!.stage).toBe("dm_sent");
    expect(handleIncoming(db, lead.id, "I'd like to know more").counted).toBe(true);
    const activity = listActivity(db, { leadId: lead.id });
    expect(activity.filter((row) => row.action === "message.auto_reply_ignored")).toHaveLength(1);
    expect(activity.filter((row) => row.action === "lead.handoff")).toHaveLength(1);
    expect(activity.filter((row) => row.action === "message.received")).toHaveLength(2);
  });
  it("never reopens a handed-off conversation that was later stopped", () => {
    const { lead } = toDmSent();
    expect(handleIncoming(db, lead.id, "Please send details").counted).toBe(true);
    markDoNotContact(db, lead.id, "asked to stop", "t");
    expect(handleIncoming(db, lead.id, "New text from the same person").counted).toBe(false);
    expect(getLead(db, lead.id)!.stage).toBe("closed");
    expect(listActivity(db, { leadId: lead.id }).filter((row) => row.action === "lead.handoff")).toHaveLength(1);
  });
  it("do-not-contact closes the lead and blocks the handle", () => {
    const { lead } = toDmSent();
    markDoNotContact(db, lead.id, "asked to stop", "t");
    expect(isDnc(db, "@target")).toBe(true);
    expect(getLead(db, lead.id)!.stage).toBe("closed");
  });
});

describe("jobs", () => {
  it("claims once, retries with backoff, then fails for good", () => {
    enqueue(db, { type: "x" });
    const j1 = claimNext(db)!;
    expect(claimNext(db)).toBeNull();
    failJob(db, j1, "boom");
    expect(claimNext(db)).toBeNull(); // pushed 10 minutes into the future
    db.prepare("UPDATE jobs SET run_after = datetime('now','-1 minute')").run();
    const j2 = claimNext(db)!; expect(j2.attempts).toBe(2);
    failJob(db, j2, "boom");
    db.prepare("UPDATE jobs SET run_after = datetime('now','-1 minute')").run();
    const j3 = claimNext(db)!; failJob(db, j3, "boom");
    expect(db.prepare("SELECT status FROM jobs").get()).toEqual({ status: "failed" });
  });
  it("puts stuck jobs back after a crash", () => {
    enqueue(db, { type: "x" }); claimNext(db);
    expect(requeueStuck(db)).toBe(1);
    const j = claimNext(db)!; completeJob(db, j.id);
  });
  it("does not retry a send after a crash when its outcome is unknown", () => {
    const { acct, camp, lead } = seed(true);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["Hello"], campaign: camp }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    claimNext(db);

    expect(requeueStuck(db)).toBe(1);

    expect(listMessages(db, { leadId: lead.id })[0].status).toBe("failed");
    expect(db.prepare("SELECT status,last_error FROM jobs WHERE type='send'").get()).toMatchObject({ status: "failed", last_error: expect.stringContaining("Check Instagram before trying again") });
    expect(claimNext(db)).toBeNull();
  });
  it("marks a stuck send done if the message was already recorded sent", () => {
    const { acct, camp, lead } = seed(true);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["Hello"], campaign: camp }, "t");
    approveMessage(db, message.id, "t");
    db.prepare("UPDATE messages SET status='sent' WHERE id=?").run(message.id);
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    claimNext(db);

    expect(requeueStuck(db)).toBe(1);
    expect(db.prepare("SELECT status FROM jobs WHERE type='send'").get()).toEqual({ status: "done" });
    expect(listMessages(db, { leadId: lead.id })[0].status).toBe("sent");
  });
});

describe("worker status", () => {
  it("is running only while the heartbeat is fresh", async () => {
    const { beat, workerStatus } = await import("@/lib/queries/worker-status");
    const t = new Date("2026-10-20T12:00:00Z");
    expect(workerStatus(db, t).running).toBe(false);
    beat(db, t);
    expect(workerStatus(db, new Date(t.getTime() + 10_000)).running).toBe(true);
    expect(workerStatus(db, new Date(t.getTime() + 60_000)).running).toBe(false);
  });
});
