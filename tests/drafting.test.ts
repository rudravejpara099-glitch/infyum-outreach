import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead, assignLead, moveStage } from "@/lib/db/repos/leads";
import { draftFirstDm } from "@/lib/services/drafting";
import { checkDraft, parseParts } from "@/lib/engine/validate";
import type { AiEngine } from "@/lib/engine/types";

const LINK = "https://portfolio.infyum.com/sales-funnel";
const good = JSON.stringify({ parts: ["The 5% rule reel stuck with me.", `I'm Rudra at Infyum, a small team in India. Your bio page has four links. ${LINK}`, "Which link do most callers use?"] });

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
  it("parses JSON even inside code fences", () => expect(parseParts("```json\n" + good + "\n```")).toHaveLength(3));
  it("rejects wrong shapes", () => {
    expect(checkDraft([], "dm")).toMatch(/one to three/);
    expect(checkDraft(["a", "b", "c", "d"], "dm")).toMatch(/one to three/);
    expect(checkDraft(["just one human line"], "dm")).toBeNull();
    expect(checkDraft(["a", "no link here", "c"], "dm")).toBeNull();
    expect(checkDraft([`a ${LINK}`, `b ${LINK}`, "c"], "dm")).toBeNull();
    expect(checkDraft([`a ${LINK}`, `b ${LINK}`, `c ${LINK}`], "dm")).toMatch(/at most two/);
    expect(checkDraft(["a", `b https://evil.example/x ${LINK}`, "c"], "dm")).toMatch(/only portfolio link allowed/);
    expect(checkDraft(["a — b", `c ${LINK}`, "d"], "dm")).toBe("No dashes");
    expect(checkDraft(["I hope this finds you well, I came across your profile"], "dm")).toMatch(/Banned/);
    expect(checkDraft([`see ${LINK}`], "dm", [LINK, "https://work.example/a"])).toBeNull();
    expect(checkDraft(["see https://work.example/a"], "dm", [LINK, "https://work.example/a"])).toBeNull();
    expect(checkDraft(["Just checking in again."], "followup")).toMatch(/Filler/);
    expect(checkDraft(["Hello"], "followup")).toBeNull();
  });
});

describe("drafting", () => {
  it("stores a valid first DM", async () => {
    const m = await draftFirstDm(db, fake([good]), leadId, "bio: credit coach");
    expect(m).toMatchObject({ kind: "dm", status: "approved" });
    expect(m.parts).toHaveLength(3);
  });
  it("retries after a bad answer and stops after three failures", async () => {
    const e = fake(["not json", good]);
    await draftFirstDm(db, e, leadId, "");
    expect(e.calls).toBe(2);
    const bad = fake(["{\"parts\":[\"I hope this finds you well\"]}"]);
    await expect(draftFirstDm(db, bad, leadId, "")).rejects.toThrow(/acceptable dm draft/);
    expect(bad.calls).toBe(3);
  });
});
