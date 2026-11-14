import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead, assignLead, getLead, moveStage } from "@/lib/db/repos/leads";
import { listActivity } from "@/lib/db/repos/activity";
import { draftFirstDm, draftFollowup } from "@/lib/services/drafting";
import { checkDraft, parseDmResult, parseParts } from "@/lib/engine/validate";
import type { AiEngine } from "@/lib/engine/types";

const LINK = "https://portfolio.infyum.com/sales-funnel";
const DM = "Your 5% rule reel stuck with me, and I noticed the link in your bio sends people to a busy page with four options. Anyone who watched the reel and is not ready to book a call has nowhere easy to go next. Want me to show you a simpler path in a quick 2 minute Loom? Sunil | INFYUM";
const good = JSON.stringify({ skip: false, why: "Reel gets attention, bio link is busy.", parts: [DM], flags: "location unconfirmed, assumed US" });

function fake(answers: string[]): AiEngine & { calls: number } {
  return { calls: 0, async complete() { return answers[Math.min(this.calls++, answers.length - 1)]; } };
}

let db: Db; let leadId: number;
beforeEach(() => {
  db = openDb(":memory:");
  const acct = createAccount(db, { handle: "me", profileDir: "/tmp/x" }, "t");
  const camp = createCampaign(db, { name: "c", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 9, approvalRequired: false, followupsEnabled: true }, [acct.id], "t");
  leadId = addLead(db, { handle: "target", campaignId: camp.id }, "t").lead.id;
  assignLead(db, leadId, camp.id, acct.id);
  moveStage(db, leadId, "qualified", "t"); moveStage(db, leadId, "warmed", "t");
});

describe("draft validation", () => {
  it("parses JSON even inside code fences", () => {
    expect(parseParts("```json\n" + good + "\n```")).toHaveLength(1);
    expect(parseDmResult("```json\n" + good + "\n```")).toMatchObject({ skip: false, parts: [DM] });
  });
  it("reads a SKIP answer", () => expect(parseDmResult('{"skip":true,"reason":"Personal account, no offer"}')).toEqual({ skip: true, reason: "Personal account, no offer" }));
  it("rejects wrong shapes", () => {
    expect(checkDraft([DM, DM], "dm")).toMatch(/exactly one/);
    expect(checkDraft([`${DM} ${LINK}`], "dm")).toMatch(/must not contain a link/);
    expect(checkDraft(["Too short to be a real message."], "dm")).toMatch(/50 to 110 words/);
    expect(checkDraft([DM.replace("with me", "with me — really")], "dm")).toBeNull(); // Sunil's own examples use a long dash and arrows
    expect(checkDraft(["Great reply — thanks"], "reply")).toBe("No dashes");
    expect(checkDraft([DM], "dm")).toBeNull();
    expect(checkDraft(["Just checking in again."], "followup")).toMatch(/Filler/);
    expect(checkDraft(["Hello"], "followup")).toBeNull();
  });
});

describe("Sunil's reference DMs", () => {
  const crystal = "Crystal, 10 years of giving the Purpose Planner away for free, and thousands of downloads \u{1F44F}\u{1F3FE} That's a serious audience of women already planning their purpose with you.\n\nSomething I kept thinking about: how many of those planner women have a book or message inside them and don't know DayeLight exists? Feels like a funnel waiting to be built. Download the planner \u2192 a few emails sharing your story and authors like Kemone \u2192 an invite to work with you.\n\nYou said it best yourself: \"No sales, no impact.\" \u{1F604} Would love to show you what that could look like before 2027 planning season kicks off.\n\n\u2014 Sunil from INFYUM";
  it("pass our checks, including paragraphs, emojis, arrows and a long-dash sign-off", () => expect(checkDraft([crystal], "dm")).toBeNull());
});

describe("drafting", () => {
  it("stores a valid first DM as one message and logs why and flags", async () => {
    const m = await draftFirstDm(db, fake([good]), leadId, "bio: credit coach");
    expect(m).toMatchObject({ kind: "dm", status: "approved" });
    expect(m!.parts).toEqual([DM]);
    expect(listActivity(db, { leadId }).some((a) => a.action === "dm.drafted" && /Why this angle/.test(String(a.detail)) && /Flags: location unconfirmed/.test(String(a.detail)))).toBe(true);
  });
  it("writes the follow-up with the DM and uses it when the lead has not replied", async () => {
    const followup = "Kami, one more thought: your podcast guests could lead listeners into a 2027 waitlist. Happy to map it out on a short video.";
    await draftFirstDm(db, fake([JSON.stringify({ skip: false, profile: "Kami, coach, 2.3K, Denver", why: "w", parts: [DM], followup, flags: "" })]), leadId, "bio");
    const never = fake(["should not be called"]);
    const f = await draftFollowup(db, never, leadId, "bio");
    expect(f).toMatchObject({ kind: "followup" });
    expect(f.parts).toEqual([followup]);
    expect(never.calls).toBe(0);
    expect(listActivity(db, { leadId }).some((a) => a.action === "dm.drafted" && /Profile: Kami, coach/.test(String(a.detail)))).toBe(true);
  });
  it("skips a lead the writer judges not a fit and creates no message", async () => {
    const m = await draftFirstDm(db, fake(['{"skip":true,"reason":"Personal account, no coaching offer"}']), leadId, "");
    expect(m).toBeNull();
    expect(getLead(db, leadId)).toMatchObject({ stage: "skipped" });
  });
  it("retries after a bad answer and stops after three failures", async () => {
    const e = fake(["not json", good]);
    await draftFirstDm(db, e, leadId, "");
    expect(e.calls).toBe(2);
    const bad = fake(['{"parts":["only one short line"]}']);
    await expect(draftFirstDm(db, bad, leadId, "")).rejects.toThrow(/acceptable dm draft/);
    expect(bad.calls).toBe(3);
  });
});

describe("quality bar for first DMs", () => {
  const notes = "Michelle Kuei. Hosts the Make It Visible podcast, 250+ episodes. Coach With Clients Academy $397/month. Client Enrollment Method for coaches.";
  const good = "Michelle, 250+ episodes of Make It Visible is a serious body of work.\n\nGenuine question: after coaches join the Academy, who builds their pages and sequences once they have learned the Client Enrollment Method? I'd guess plenty stall on building it. That's the part we build at INFYUM, so if a partnership ever made sense for your community, I'd love to chat.\n\nSunil | INFYUM";
  it("passes a grounded DM with a question", () => expect(checkDraft([good], "dm", { notes, teachesMarketing: true })).toBeNull());
  it("rejects a DM with no question", () => expect(checkDraft([good.replaceAll("?", ".")], "dm", { notes })).toMatch(/easy question/));
  it("rejects defensive pitch phrasing", () => expect(checkDraft([good.replace("I'd love to chat.", "No pitch, I'd love to chat?")], "dm", { notes })).toMatch(/no pitch/i));
  it("rejects a DM that names nothing from the profile", () => {
    const generic = "Hey Michelle, love what you are doing for coaches and your content is great.\n\nMost people in your space struggle with getting consistent leads and a lot of them lose time to manual follow up every single week. Want me to record a short video showing a few ideas that could help your business grow faster this year, no cost at all?\n\nSunil | INFYUM";
    expect(checkDraft([generic], "dm", { notes })).toMatch(/specific detail/);
  });
  it("rejects marketing advice to a marketing teacher", () => {
    const advice = "Michelle, Make It Visible has 250+ episodes, impressive.\n\nI noticed Eve's result is the only hard number, and more social proof would carry the page for coaches deciding on the Academy. You should add a few more. Want a short Loom on that?\n\nSunil | INFYUM";
    expect(checkDraft([advice], "dm", { notes, teachesMarketing: true })).toMatch(/never advise/);
  });
});
