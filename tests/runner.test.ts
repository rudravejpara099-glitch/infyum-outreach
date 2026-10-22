import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount, getAccount, setAccountBrowserMode } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { addLead, getLead, moveStage } from "@/lib/db/repos/leads";
import { approveMessage, approvedQueue, createOutgoing, getMessage, listMessages } from "@/lib/db/repos/messages";
import { enqueue } from "@/lib/db/repos/jobs";
import { InstagramBlockedError, InstagramSendUncertainError, type InstagramDriver } from "@/worker/driver";
import { planWork, runLanesUntilIdle, runOne, runUntilIdle, type Deps } from "@/worker/runner";

const LINK = "https://portfolio.infyum.com/sales-funnel";
const dm = JSON.stringify({ parts: ["The 5% rule reel stuck with me.", `I'm Rudra at Infyum, a small team in India. ${LINK}`, "Which link do most callers use?"] });

class FakeDriver implements InstagramDriver {
  sent: { handle: string; parts: string[] }[] = [];
  inbox: { handle: string; text: string }[] = [];
  factsRead = 0; warmups = 0; inboxReads = 0;
  facts = { isPublic: true, country: "United States", followers: 5000, linkedToInfyum: false };
  blockOnSend = false;
  uncertainOnSend = false;
  errorOnSend = false;
  async openLogin() { return true; }
  async readFacts(account?: unknown) { void account; this.factsRead++; return this.facts; }
  async readProfileNotes() { return "bio: credit coach in Texas"; }
  async warmUp() { this.warmups++; return { likes: 10, comments: 10, followed: true }; }
  async sendMessages(_a: unknown, handle: string, parts: string[]) {
    if (this.blockOnSend) throw new InstagramBlockedError("Action blocked");
    if (this.errorOnSend) throw new Error("Chat did not open");
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
  it("allows Chrome mode to qualify profiles and sync replies, but blocks every other campaign action", async () => {
    const { acct, camp } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "read-only-target", campaignId: camp.id }, "t");
    db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(acct.id, lead.id);
    const complete = vi.spyOn(engine, "complete");
    enqueue(db, { type: "qualify", leadId: lead.id, accountId: acct.id });
    await runOne(deps);
    expect(driver.factsRead).toBe(1);
    expect(getLead(db, lead.id)?.stage).toBe("qualified");

    for (const type of ["warmup", "draft_dm", "draft_followup", "send"]) {
      enqueue(db, { type, leadId: lead.id, accountId: acct.id, payload: { messageId: 999 } });
    }
    for (let i = 0; i < 4; i++) await runOne(deps);
    expect(driver.warmups).toBe(0);
    expect(driver.sent).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) n FROM jobs WHERE status='queued' AND type IN ('warmup','draft_dm','draft_followup','send')").get()).toEqual({ n: 4 });
  });

  it("allows Chrome mode inbox reads for matching accounts only", async () => {
    const { acct } = setup(true);
    setAccountBrowserMode(db, acct.id, "chrome_read_only", "t");
    const { lead } = addLead(db, { handle: "known-lead", stage: "dm_sent" }, "t");
    driver.inbox = [{ handle: "known-lead", text: "Can you explain the funnel?" }];
    enqueue(db, { type: "check_inbox", accountId: acct.id });
    await runOne(deps);
    expect(driver.inboxReads).toBe(1);
    expect(getLead(db, lead.id)?.stage).toBe("replied");
    expect(listMessages(db, { leadId: lead.id }).some((message) => message.direction === "in" && message.parts.join(" ").includes("explain the funnel"))).toBe(true);
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
    planWork(deps);
    await runOne(deps, { accountId: 1 });
    expect(listMessages(db, { leadId: lead.id }).some((m) => m.kind === "dm")).toBe(true);
  });
});
