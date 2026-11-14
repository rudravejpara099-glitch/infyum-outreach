import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead, assignLead, getLead, moveStage } from "@/lib/db/repos/leads";
import { listActivity } from "@/lib/db/repos/activity";
import { draftFirstDm } from "@/lib/services/drafting";
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
    expect(checkDraft(["Too short to be a real message."], "dm")).toMatch(/50 to 90 words/);
    expect(checkDraft([DM.replace("with me", "with me — really")], "dm")).toBe("No dashes");
    expect(checkDraft([DM], "dm")).toBeNull();
    expect(checkDraft(["Just checking in again."], "followup")).toMatch(/Filler/);
    expect(checkDraft(["Hello"], "followup")).toBeNull();
  });
});

describe("drafting", () => {
  it("stores a valid first DM as one message and logs why and flags", async () => {
    const m = await draftFirstDm(db, fake([good]), leadId, "bio: credit coach");
    expect(m).toMatchObject({ kind: "dm", status: "approved" });
    expect(m!.parts).toEqual([DM]);
    expect(listActivity(db, { leadId }).some((a) => a.action === "dm.drafted" && /Why this angle/.test(String(a.detail)) && /Flags: location unconfirmed/.test(String(a.detail)))).toBe(true);
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
