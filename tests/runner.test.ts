import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount, getAccount, setAccountBrowserMode, setAccountStatus } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignAccounts, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { addLead, getLead, moveStage } from "@/lib/db/repos/leads";
import { approveMessage, approvedQueue, createOutgoing, getMessage, listMessages, markSent } from "@/lib/db/repos/messages";
import { enqueue, requeueStuck } from "@/lib/db/repos/jobs";
import { AlreadyContactedError, InstagramBlockedError, InstagramSendUncertainError, InstagramWarmupUncertainError, type InstagramDriver } from "@/worker/driver";
import { planWork, runLanesUntilIdle, runOne, runUntilIdle, type Deps } from "@/worker/runner";
import { handleIncoming } from "@/lib/services/outreach";

const LINK = "https://portfolio.infyum.com/sales-funnel";
const dm = JSON.stringify({ parts: ["The 5% rule reel stuck with me.", `I'm Rudra at Infyum, a small team in India. ${LINK}`, "Which link do most callers use?"] });

class FakeDriver implements InstagramDriver {
  sent: { handle: string; parts: string[] }[] = [];
  inbox: { handle: string; text: string }[] = [];
  factsRead = 0; warmups = 0; inboxReads = 0;
  authenticated = true;
  facts = { isPublic: true, country: "United States", followers: 5000, linkedToInfyum: false };
  blockOnSend = false;
  uncertainOnSend = false;
  errorOnSend = false;
  alreadyContacted = false;
  async openLogin() { return this.authenticated; }
  async readFacts(account?: unknown) { void account; this.factsRead++; return this.facts; }
  async readProfileNotes() { return "bio: credit coach in Texas"; }
  async warmUp() { this.warmups++; return { likes: 10, comments: 10, followed: true }; }
  async sendMessages(_a: unknown, handle: string, parts: string[]) {
    if (this.blockOnSend) throw new InstagramBlockedError("Action blocked");
    if (this.errorOnSend) throw new Error("Chat did not open");
    if (this.alreadyContacted) throw new AlreadyContactedError(handle);
    this.sent.push({ handle, parts });
    if (this.uncertainOnSend) throw new InstagramSendUncertainError();
  }
  async readInbox() { this.inboxReads++; const out = this.inbox; this.inbox = []; return out; }
}

let db: Db; let driver: FakeDriver; let deps: Deps; let clock: Date;
const reply = JSON.stringify({ parts: ["Happy to explain. We build funnels and pages. What does your booking page look like today?"] });
const engine = { async complete({ prompt }: { prompt: string }) {
  if (prompt.includes("Write one short Instagram comment")) return "Love this 🙌";
  return prompt.includes("replied. Write the next message") ? reply : dm;
} };

function setup(approvalRequired: boolean) {
  const acct = createAccount(db, { handle: "me", profileDir: "/tmp/x", dailyCap: 35 }, "t");
  db.prepare("UPDATE ig_accounts SET ramp_start = '2026-01-01'").run();
  const camp = createCampaign(db, { name: "c", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired, followupsEnabled: true }, [acct.id], "t");
  setCampaignStatus(db, camp.id, "active", "t");
  return { acct, camp };
}

beforeEach(() => {
  db = openDb(":memory:"); driver = new FakeDriver(); clock = new Date("2026-10-20T10:00:00Z");
  deps = { db, engine, driver, now: () => clock, pace: async () => {} };
});
afterEach(() => db.close());

describe("worker pipeline", () => {
  it("does not recreate a qualification job after its automatic retries are exhausted", () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "failed-qualification", campaignId: camp.id }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    db.prepare("INSERT INTO jobs (type,lead_id,account_id,status,last_error) VALUES ('qualify',?,?,'failed','read failed')").run(lead.id, acct.id);

    planWork(deps);

    expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='qualify' AND lead_id=? AND status='queued'").get(lead.id)).toEqual({ n: 0 });
  });

  it("waits instead of failing a warm-up when the local writer is not running", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "writer-down", campaignId: camp.id, stage: "qualified" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    enqueue(db, { type: "warmup", leadId: lead.id, accountId: acct.id });
    deps.engine = { ...engine, async assertReady() { throw new Error("Local writing is unavailable or returned an invalid response. Start Ollama."); } };

    await runOne(deps, { accountId: acct.id });

    expect(driver.warmups).toBe(0);
    expect(db.prepare("SELECT status FROM jobs WHERE type='warmup' AND lead_id=?").get(lead.id)).toEqual({ status: "queued" });
  });

  it("does not repeat a warm-up after crash recovery held it for review", () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "interrupted-warmup", campaignId: camp.id, stage: "qualified" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    db.prepare("INSERT INTO jobs (type,lead_id,account_id,status) VALUES ('warmup',?,?,'running')").run(lead.id, acct.id);

    expect(requeueStuck(db)).toBe(1);
    planWork(deps);

    expect(db.prepare("SELECT status FROM jobs WHERE type='warmup' AND lead_id=?").get(lead.id)).toEqual({ status: "failed" });
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='warmup' AND lead_id=? AND status='queued'").get(lead.id)).toEqual({ n: 0 });
    expect(driver.warmups).toBe(0);
  });

  it("takes Chrome leads through preparation and holds the first message for approval", async () => {
    const { acct, camp } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "manual-first-dm", campaignId: camp.id }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);

    planWork(deps);
    expect(db.prepare("SELECT type FROM jobs WHERE lead_id=? AND status='queued'").all(lead.id)).toContainEqual({ type: "qualify" });
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)?.stage).toBe("warmed");
    expect(driver.warmups).toBe(1);
    expect(listMessages(db, { leadId: lead.id })[0].status).toBe("pending_approval");
    expect(driver.sent).toHaveLength(0);

    planWork(deps);
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE lead_id=? AND type IN ('warmup','draft_dm','draft_followup') AND status='queued'").get(lead.id)).toEqual({ n: 0 });
  });

  it("checks writing readiness before any Chrome preparation action", async () => {
    const { acct, camp } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "read-only-target", campaignId: camp.id }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const complete = vi.fn();
    deps.engine = { complete, assertReady: () => { throw new Error("Paid writing is off"); } };
    enqueue(db, { type: "qualify", leadId: lead.id, accountId: acct.id });
    await runOne(deps);
    expect(driver.factsRead).toBe(1);
    expect(getLead(db, lead.id)?.stage).toBe("qualified");

    enqueue(db, { type: "warmup", leadId: lead.id, accountId: acct.id });
    await runOne(deps);
    expect(driver.warmups).toBe(0);
    expect(driver.sent).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
    expect(getLead(db, lead.id)?.stage).toBe("qualified");
  });

  it("holds a partly completed warm-up permanently so the planner cannot duplicate comments", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "partly-prepared", campaignId: camp.id, stage: "qualified" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    driver.warmUp = async () => { throw new InstagramWarmupUncertainError(true); };
    enqueue(db, { type: "warmup", leadId: lead.id, accountId: acct.id });
    await runOne(deps);
    planWork(deps);
    expect(getLead(db, lead.id)?.stage).toBe("qualified");
    expect(getAccount(db, acct.id)?.status).toBe("blocked");
    expect(db.prepare("SELECT status FROM jobs WHERE type='warmup' AND lead_id=?").all(lead.id)).toEqual([{ status: "failed" }]);
  });

  it("waits and retries a warm-up when Chrome cannot be reached, because nothing happened on Instagram", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "chrome-offline", campaignId: camp.id, stage: "qualified" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    driver.warmUp = async () => { throw new Error("Chrome’s debugging connection file is missing. Enable remote debugging in your signed-in Chrome profile, then retry."); };
    enqueue(db, { type: "warmup", leadId: lead.id, accountId: acct.id });
    await runOne(deps);
    expect(db.prepare("SELECT status, attempts FROM jobs WHERE type='warmup' AND lead_id=?").all(lead.id)).toEqual([{ status: "queued", attempts: 0 }]);
    expect(getAccount(db, acct.id)?.status).toBe("active");
  });

  it("allows Chrome mode inbox reads for matching accounts only", async () => {
    const { acct } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "known-lead", stage: "dm_sent" }, "t");
    const oldCheck = enqueue(db, { type: "check_inbox", accountId: acct.id });
    db.prepare("UPDATE jobs SET status='failed',last_error='old timeout' WHERE id=?").run(oldCheck);
    driver.inbox = [{ handle: "known-lead", text: "Can you explain the funnel?" }];
    enqueue(db, { type: "check_inbox", accountId: acct.id });
    await runOne(deps);
    expect(driver.inboxReads).toBe(1);
    expect(getLead(db, lead.id)?.stage).toBe("replied");
    expect(listMessages(db, { leadId: lead.id }).some((message) => message.direction === "in" && message.parts.join(" ").includes("explain the funnel"))).toBe(true);
    expect(db.prepare("SELECT status,last_error FROM jobs WHERE id=?").get(oldCheck)).toEqual({ status: "done", last_error: "" });
    expect(db.prepare("SELECT action,detail FROM activity WHERE action='inbox.checked'").get()).toEqual({ action: "inbox.checked", detail: "1 new reply handed off." });
    expect(driver.sent).toHaveLength(0);
  });

  it("takes a lead from found to dm_sent on its own when approval is off", async () => {
    const { camp } = setup(false);
    const { lead } = addLead(db, { handle: "target", campaignId: camp.id }, "t");
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)!.stage).toBe("dm_sent");
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0].parts).toHaveLength(3);
  });

  it("waits at the approval queue and sends only after a human approves", async () => {
    const { camp } = setup(true);
    const { lead } = addLead(db, { handle: "target", campaignId: camp.id }, "t");
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)!.stage).toBe("warmed");
    expect(driver.sent).toHaveLength(0);
    const pending = listMessages(db, { status: "pending_approval" })[0];
    approveMessage(db, pending.id, "me");
    await runUntilIdle(deps);
    expect(driver.sent).toHaveLength(1);
    expect(getLead(db, lead.id)!.stage).toBe("dm_sent");
  });

  it("sends an approved Chrome-mode DM while preserving campaign approval", async () => {
    const { acct, camp } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "chrome-approved-target", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A human-approved message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });

    await runOne(deps);

    expect(driver.sent).toEqual([{ handle: "chrome-approved-target", parts: ["A human-approved message"] }]);
    expect(getMessage(db, message.id)?.status).toBe("sent");
    expect(getLead(db, lead.id)?.stage).toBe("dm_sent");
  });

  it("sends an approved Chrome-mode first DM then durably hands off the first reply", async () => {
    const { acct, camp } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "first-contact-cycle", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, {
      leadId: lead.id, accountId: acct.id, kind: "dm",
      parts: ["Relevant observation.", "Who I am and the permitted portfolio link.", "One simple question."],
      campaign: { approvalRequired: true },
    }, "t");
    expect(message.status).toBe("pending_approval");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });

    await runOne(deps);

    expect(driver.sent).toEqual([{ handle: "first-contact-cycle", parts: message.parts }]);
    expect(getMessage(db, message.id)?.status).toBe("sent");
    expect(getLead(db, lead.id)?.stage).toBe("dm_sent");

    driver.inbox = [{ handle: "first-contact-cycle", text: "Yes, please tell me more." }];
    enqueue(db, { type: "check_inbox", accountId: acct.id });
    await runOne(deps);

    expect(getLead(db, lead.id)?.stage).toBe("replied");
    expect(listMessages(db, { leadId: lead.id }).filter((item) => item.direction === "in")).toHaveLength(1);
    expect(db.prepare("SELECT count(*) n FROM activity WHERE lead_id=? AND action='lead.handoff'").get(lead.id)).toEqual({ n: 1 });
    expect(db.prepare("SELECT next_followup_at FROM leads WHERE id=?").get(lead.id)).toEqual({ next_followup_at: null });
    expect(driver.sent).toHaveLength(1);
  });

  it("does not dispatch an already queued approved message after its campaign is finished", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "finish-before-send", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A reviewed message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    setCampaignStatus(db, camp.id, "done", "t");

    await runOne(deps);

    expect(driver.sent).toHaveLength(0);
    expect(getMessage(db, message.id)?.status).toBe("approved");
    expect(approvedQueue(db)).toHaveLength(0);
    expect((db.prepare("SELECT status FROM jobs WHERE type='send'").get() as { status: string }).status).toBe("done");
  });
  it("does not send when the campaign is paused during the final send wait", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "paused-during-wait", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A reviewed message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    deps.pace = async () => { setCampaignStatus(db, camp.id, "paused", "t"); };

    await runOne(deps);

    expect(driver.sent).toHaveLength(0);
    expect(getMessage(db, message.id)?.status).toBe("approved");
  });
  it("does not send when its account is removed from the campaign during the final wait", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "sender-removed", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A reviewed message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    deps.pace = async () => { setCampaignAccounts(db, camp.id, []); };

    await runOne(deps);

    expect(driver.sent).toHaveLength(0);
    expect(getMessage(db, message.id)?.status).toBe("approved");
  });
  it("does not send a queued approved DM once the prospect writes first", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "early-reply", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A reviewed message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    handleIncoming(db, lead.id, "I reached out first");
    await runOne(deps);
    planWork(deps);
    expect(driver.sent).toHaveLength(0);
    expect(getLead(db, lead.id)?.stage).toBe("replied");
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='send' AND status='queued'").get()).toEqual({ n: 0 });
  });

  it("rechecks the handoff after pacing an approved follow-up", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "reply-during-wait", campaignId: camp.id, stage: "dm_sent" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "followup", parts: ["A reviewed follow-up"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    deps.pace = async () => { handleIncoming(db, lead.id, "I have a question"); };
    await runOne(deps);
    expect(driver.sent).toHaveLength(0);
    expect(getLead(db, lead.id)?.stage).toBe("replied");
  });
  it("keeps checking for a first reply after a campaign is paused", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "waiting-for-reply", campaignId: camp.id, stage: "dm_sent" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    setCampaignStatus(db, camp.id, "paused", "t");
    driver.inbox = [{ handle: lead.handle, text: "I am interested" }];
    planWork(deps);
    await runOne(deps);
    expect(driver.inboxReads).toBe(1);
    expect(getLead(db, lead.id)?.stage).toBe("replied");
  });

  it("holds an uncertain multi-part send for human checking instead of retrying", async () => {
    const { camp } = setup(false);
    driver.uncertainOnSend = true;
    addLead(db, { handle: "uncertain-send", campaignId: camp.id }, "t");

    await runUntilIdle(deps);
    await runUntilIdle(deps);

    expect(driver.sent).toHaveLength(1);
    expect(listMessages(db, { status: "failed" })[0]).toMatchObject({ status: "failed", kind: "dm" });
    expect((db.prepare("SELECT status,last_error FROM jobs WHERE type='send'").get() as { status: string; last_error: string })).toMatchObject({ status: "failed", last_error: expect.stringContaining("Check the Instagram conversation") });
  });

  it("never sends a first message into a conversation that already holds our outreach", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "messaged-by-hand", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A reviewed message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    driver.alreadyContacted = true;

    await runOne(deps);
    planWork(deps);

    expect(driver.sent).toHaveLength(0);
    expect(getMessage(db, message.id)?.status).toBe("failed");
    expect(getLead(db, lead.id)?.stage).toBe("dm_sent");
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='send' AND status='queued'").get()).toEqual({ n: 0 });
  });

  it("stops fresh send jobs after known pre-send retries are exhausted", async () => {
    const { acct, camp } = setup(true);
    const { lead } = addLead(db, { handle: "open-failed-chat", campaignId: camp.id, stage: "warmed" }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const message = createOutgoing(db, { leadId: lead.id, accountId: acct.id, kind: "dm", parts: ["A reviewed message"], campaign: { approvalRequired: true } }, "t");
    approveMessage(db, message.id, "t");
    enqueue(db, { type: "send", leadId: lead.id, accountId: acct.id, payload: { messageId: message.id } });
    driver.errorOnSend = true;

    for (let attempt = 0; attempt < 3; attempt++) {
      await runOne(deps);
      db.prepare("UPDATE jobs SET run_after=datetime('now','-1 minute') WHERE type='send'").run();
    }
    planWork(deps);

    expect(driver.sent).toHaveLength(0);
    expect(getMessage(db, message.id)?.status).toBe("failed");
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='send' AND status='queued'").get()).toEqual({ n: 0 });
  });

  it("skips a lead that fails the rules and records why", async () => {
    const { camp } = setup(false);
    driver.facts = { ...driver.facts, country: "India" };
    const { lead } = addLead(db, { handle: "far", campaignId: camp.id }, "t");
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)).toMatchObject({ stage: "skipped", skipReason: "Based in India" });
    expect(driver.sent).toHaveLength(0);
  });

  it("never sends more than the daily limit and picks up again the next day", async () => {
    const { camp, acct } = setup(false);
    db.prepare("UPDATE ig_accounts SET daily_cap = 2").run();
    for (const h of ["a", "b", "c"]) addLead(db, { handle: h, campaignId: camp.id }, "t");
    // Each lead gets a different draft so the similarity guard does not interfere.
    let n = 0;
    deps.engine = { async complete({ prompt }) {
      if (prompt.includes("Write one short Instagram comment")) return "Nice 🙌";
      n++;
      return JSON.stringify({ parts: [`Unique opener number ${n} about topic${n}x${n}y`, `I'm Rudra at Infyum, small team in India. ${LINK}`, `Question number ${n} about funnel${n}z?`] });
    } };
    await runUntilIdle(deps);
    expect(driver.sent).toHaveLength(2);
    expect(listMessages(db, { status: "sent" }).filter((message) => message.kind === "dm").map((message) => message.sentAt)).toEqual([
      "2026-10-20 10:00:00",
      "2026-10-20 10:00:00",
    ]);
    expect(getAccount(db, acct.id)!.status).toBe("active");
    clock = new Date("2026-10-21T10:00:00Z");
    db.prepare("UPDATE jobs SET run_after = datetime('now','-1 minute') WHERE status='queued'").run();
    await runUntilIdle(deps);
    expect(driver.sent).toHaveLength(3);
  });

  it("enforces the cap by the saved team-local day after UTC midnight", async () => {
    const { camp, acct } = setup(false);
    db.prepare("UPDATE ig_accounts SET daily_cap=1").run();
    db.prepare("INSERT INTO settings (key,value) VALUES ('team_timezone','Asia/Kolkata')").run();
    const earlier = addLead(db, { handle: "already-sent", campaignId: camp.id }, "t").lead;
    const earlierMessage = createOutgoing(db, { leadId: earlier.id, accountId: acct.id, kind: "dm", parts: ["Earlier local-day message"], campaign: camp }, "t");
    markSent(db, earlierMessage.id, new Date("2026-10-20T20:00:00Z"));

    const next = addLead(db, { handle: "must-wait", campaignId: camp.id }, "t").lead;
    moveStage(db, next.id, "qualified", "t"); moveStage(db, next.id, "warmed", "t");
    const message = createOutgoing(db, { leadId: next.id, accountId: acct.id, kind: "dm", parts: ["Another unique message"], campaign: camp }, "t");
    enqueue(db, { type: "send", leadId: next.id, accountId: acct.id, payload: { messageId: message.id } });
    clock = new Date("2026-10-21T00:15:00Z"); // Oct 21 in Kolkata, while the previous send is still today's local send.

    await runOne(deps, { accountId: acct.id });

    expect(driver.sent).toHaveLength(0);
    expect(getMessage(db, message.id)?.status).toBe("approved");
    expect(db.prepare("SELECT status FROM jobs WHERE type='send' ORDER BY id DESC LIMIT 1").get()).toMatchObject({ status: "queued" });
  });

  it("blocks the account the moment Instagram shows a warning", async () => {
    const { camp, acct } = setup(false);
    driver.blockOnSend = true;
    addLead(db, { handle: "target", campaignId: camp.id }, "t");
    await runUntilIdle(deps);
    expect(getAccount(db, acct.id)).toMatchObject({ status: "blocked" });
    expect(driver.sent).toHaveLength(0);
  });

  it("reads replies, ignores auto-replies, and hands off without drafting", async () => {
    const { camp } = setup(false);
    const { lead } = addLead(db, { handle: "target", campaignId: camp.id }, "t");
    await runUntilIdle(deps);
    driver.inbox = [{ handle: "target", text: "Thanks for contacting us, we've received your message." }, { handle: "stranger", text: "hi" }];
    clock = new Date("2026-10-20T11:00:00Z");
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)!.stage).toBe("dm_sent");
    driver.inbox = [{ handle: "target", text: "Interesting, what do you do exactly?" }];
    clock = new Date("2026-10-20T12:00:00Z");
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)!.stage).toBe("replied");
    expect(listMessages(db, { leadId: lead.id }).some((m) => m.kind === "reply")).toBe(false);
  });

  it("drafts a follow-up when it is due and nobody replied", async () => {
    const { camp } = setup(false);
    const { lead } = addLead(db, { handle: "target", campaignId: camp.id }, "t");
    await runUntilIdle(deps);
    expect(getLead(db, lead.id)!.nextFollowupAt).toBe("2026-10-22 10:00:00");
    deps.engine = { async complete() { return JSON.stringify({ parts: ["One thing I noticed: your booking page hides the call button below four other links."] }); } };
    clock = new Date("2026-10-22T10:30:00Z");
    await runUntilIdle(deps);
    expect(driver.sent).toHaveLength(2);
    expect(getLead(db, lead.id)!.followupsSent).toBe(1);
  });

  it("recovers a sign-in-only stop during the scheduled read-only inbox check", async () => {
    const { acct } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    setAccountStatus(db, acct.id, "blocked", "The saved Instagram account is not signed in in Chrome.", "worker");
    const { lead } = addLead(db, { handle: "known-lead", stage: "dm_sent" }, "t");
    driver.inbox = [{ handle: "known-lead", text: "Can you explain the funnel?" }];
    const jobId = enqueue(db, { type: "check_inbox", accountId: acct.id });

    await runOne(deps);

    expect(driver.authenticated).toBe(true);
    expect(driver.inboxReads).toBe(1);
    expect(getAccount(db, acct.id)?.status).toBe("active");
    expect(getLead(db, lead.id)?.stage).toBe("replied");
    expect(db.prepare("SELECT status FROM jobs WHERE id=?").get(jobId)).toEqual({ status: "done" });
  });

  it("keeps a sign-in stop blocked and defers replies when Chrome does not confirm the account", async () => {
    const { acct } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    setAccountStatus(db, acct.id, "blocked", "The saved Instagram account is not signed in in Chrome.", "worker");
    driver.authenticated = false;
    const jobId = enqueue(db, { type: "check_inbox", accountId: acct.id });

    await runOne(deps);

    expect(driver.inboxReads).toBe(0);
    expect(getAccount(db, acct.id)?.status).toBe("blocked");
    expect(db.prepare("SELECT status,run_after FROM jobs WHERE id=?").get(jobId)).toMatchObject({ status: "queued" });
  });

  it("does not retry Chrome for an Instagram warning during inbox recovery", async () => {
    const { acct } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    setAccountStatus(db, acct.id, "blocked", "Instagram showed a warning or human check.", "worker");
    const jobId = enqueue(db, { type: "check_inbox", accountId: acct.id });

    await runOne(deps);

    expect(driver.inboxReads).toBe(0);
    expect(getAccount(db, acct.id)?.status).toBe("blocked");
    expect(db.prepare("SELECT status,run_after FROM jobs WHERE id=?").get(jobId)).toMatchObject({ status: "queued" });
  });
});

describe("parallel accounts", () => {
  it("runs different accounts at the same time but never one account twice at once", async () => {
    const a1 = createAccount(db, { handle: "one", profileDir: "/tmp/1", dailyCap: 35 }, "t");
    const a2 = createAccount(db, { handle: "two", profileDir: "/tmp/2", dailyCap: 35 }, "t");
    db.prepare("UPDATE ig_accounts SET ramp_start = '2026-01-01'").run();
    const camp = createCampaign(db, { name: "c", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: false, followupsEnabled: true }, [a1.id, a2.id], "t");
    setCampaignStatus(db, camp.id, "active", "t");
    for (const h of ["a", "b", "c", "d"]) addLead(db, { handle: h, campaignId: camp.id }, "t");

    const active = new Map<number, number>();
    let overlapSameAccount = false, now = 0, peak = 0;
    class SlowDriver extends FakeDriver {
      async readFacts(account: { id: number }) {
        active.set(account.id, (active.get(account.id) ?? 0) + 1);
        if ((active.get(account.id) ?? 0) > 1) overlapSameAccount = true;
        now++; peak = Math.max(peak, now);
        await new Promise((r) => setTimeout(r, 25));
        now--; active.set(account.id, (active.get(account.id) ?? 1) - 1);
        return this.facts;
      }
    }
    let n = 0;
    deps = { ...deps, driver: new SlowDriver(), engine: { async complete({ prompt }) {
      if (prompt.includes("Write one short Instagram comment")) return "Nice 🙌";
      n++;
      return JSON.stringify({ parts: [`Opener ${n} about topic${n}x${n}y here`, `Rudra here from Infyum, builder number ${n} of funnels${n}q for sector${n}w firms. ${LINK}`, `Question ${n} about funnel${n}z?`] });
    } } };
    await runLanesUntilIdle(deps);

    expect(overlapSameAccount).toBe(false);          // one account never does two things at once
    expect(peak).toBe(2);                            // two accounts really overlap
    const perAccount = db.prepare("SELECT account_id, COUNT(*) c FROM leads GROUP BY account_id").all() as { account_id: number; c: number }[];
    expect(perAccount.map((r) => r.c)).toEqual([2, 2]); // work is spread evenly
    expect(db.prepare("SELECT COUNT(*) c FROM leads WHERE stage='dm_sent'").get()).toEqual({ c: 4 });
  });

  it("keeps jobs that need no account in their own lane", async () => {
    const { camp } = setup(false);
    db.prepare("INSERT INTO jobs (type, payload) VALUES ('draft_reply', ?)").run(JSON.stringify({}));
    addLead(db, { handle: "x", campaignId: camp.id }, "t");
    const n = await runLanesUntilIdle(deps);
    expect(n).toBeGreaterThan(0);
  });
});

describe("human pace in the worker", () => {
  const rng = () => 0.5;
  const sentCount = () => driver.sent.length;

  it("does nothing at night and keeps the job for the morning", async () => {
    const { camp } = setup(false);
    addLead(db, { handle: "target", campaignId: camp.id }, "t");
    clock = new Date("2026-10-21T03:00:00Z");                  // 23:00 in New York
    deps = { ...deps, now: () => clock, humanPace: { rng } };
    planWork(deps);
    await runOne(deps, { accountId: 1 });                      // qualify is held back
    const jobs = db.prepare("SELECT type, status, run_after FROM jobs WHERE type='qualify'").all() as { status: string }[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");                     // not lost, not failed
    expect(driver.sent).toHaveLength(0);
    expect(db.prepare("SELECT 1 FROM activity WHERE action='pace.off_hours'").get()).toBeTruthy();
  });

  it("works in the morning and then leaves a gap before the next action", async () => {
    const { camp } = setup(false);
    addLead(db, { handle: "target", campaignId: camp.id }, "t");
    clock = new Date("2026-10-20T14:00:00Z");                  // 10:00 local
    deps = { ...deps, now: () => clock, humanPace: { rng } };
    planWork(deps);
    expect(await runOne(deps, { accountId: 1 })).toBe(true);   // qualify runs
    const state = JSON.parse((db.prepare("SELECT value FROM settings WHERE key='pace_1'").get() as { value: string }).value);
    expect(Date.parse(state.nextActionAt)).toBeGreaterThan(clock.getTime() + 20_000);   // a gap now exists
    const before = db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='done'").get() as { c: number };
    planWork(deps);
    await runOne(deps, { accountId: 1 });                      // next step is held by the gap, not run
    expect(db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='done'").get()).toEqual(before);
    expect(sentCount()).toBe(0);
  });

  it("uses the team time zone setting", async () => {
    const { camp } = setup(false);
    addLead(db, { handle: "target", campaignId: camp.id }, "t");
    db.prepare("INSERT INTO settings (key, value) VALUES ('team_timezone','Asia/Kolkata')").run();
    clock = new Date("2026-10-20T14:00:00Z");                  // 19:30 in India: still a working hour
    deps = { ...deps, now: () => clock, humanPace: { rng } };
    planWork(deps);
    expect(await runOne(deps, { accountId: 1 })).toBe(true);
    expect(db.prepare("SELECT 1 FROM activity WHERE action='pace.off_hours'").get()).toBeFalsy();
  });

  it("does not pace AI drafting", async () => {
    const { camp } = setup(false);
    const { lead } = addLead(db, { handle: "target", campaignId: camp.id }, "t");
    moveStage(db, lead.id, "qualified", "t"); moveStage(db, lead.id, "warmed", "t");
    clock = new Date("2026-10-21T03:00:00Z");                  // night
    deps = { ...deps, now: () => clock, humanPace: { rng } };
    db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run("inbox_checked_1", String(clock.getTime()));
    planWork(deps);
    await runOne(deps, { accountId: 1 });
    expect(listMessages(db, { leadId: lead.id }).some((m) => m.kind === "dm")).toBe(true);
  });
});
