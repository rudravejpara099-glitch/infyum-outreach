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
    expect(checkDraft(["one", "two"], "dm")).toMatch(/exactly three/);
    expect(checkDraft(["a", "no link here", "c"], "dm")).toMatch(/link exactly once/);
    expect(checkDraft([`a ${LINK}`, `b ${LINK}`, "c"], "dm")).toMatch(/Only message 2/);
    expect(checkDraft(["a", `b https://evil.example/x ${LINK}`, "c"], "dm")).toMatch(/exactly once/);
    expect(checkDraft(["a — b", `c ${LINK}`, "d"], "dm")).toBe("No dashes");
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
    const bad = fake(["{\"parts\":[\"only one\"]}"]);
    await expect(draftFirstDm(db, bad, leadId, "")).rejects.toThrow(/acceptable dm draft/);
    expect(bad.calls).toBe(3);
  });
});
