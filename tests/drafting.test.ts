import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead, assignLead, moveStage } from "@/lib/db/repos/leads";
import { draftFirstDm } from "@/lib/services/drafting";
import { checkDraft, parseParts, parseVerdict } from "@/lib/engine/validate";
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
    const e = fake(["not json", good, '{"ok": true}']);
    await draftFirstDm(db, e, leadId, "");
    expect(e.calls).toBe(3); // the bad answer, the good draft, then the reviewer's pass
    const bad = fake(["{\"parts\":[\"I hope this finds you well\"]}"]);
    await expect(draftFirstDm(db, bad, leadId, "")).rejects.toThrow(/acceptable dm draft/);
    expect(bad.calls).toBe(3);
  });
});

describe("the reviewer pass on the free writer", () => {
  it("sends a draft back when the reviewer rejects it, with the reason, and keeps the one it accepts", async () => {
    const prompts: string[] = [];
    const answers = [good, '{"ok": false, "problem": "It says their bio hides the offer."}', good, '{"ok": true}'];
    let i = 0;
    const engine: AiEngine = { async complete({ prompt }) { prompts.push(prompt); return answers[i++]; } };
    const message = await draftFirstDm(db, engine, leadId, "bio: 1-on-1 coaching for founders");
    expect(message.parts).toHaveLength(3);
    expect(prompts[0]).not.toContain("rejected");
    expect(prompts[1]).toContain("bio: 1-on-1 coaching for founders");
    expect(prompts[2]).toContain("A reviewer rejected it: It says their bio hides the offer.");
    expect(i).toBe(4);
  });
  it("after three refusals keeps the draft only for a person to decide on, flagged with the concern, even when approval is otherwise off", async () => {
    const engine: AiEngine = { async complete({ prompt }) { return prompt.startsWith("You check a draft") ? '{"ok": false, "problem": "Too salesy."}' : good; } };
    const message = await draftFirstDm(db, engine, leadId, "");
    expect(message.status).toBe("pending_approval");
    expect(message.approvalReasons).toContain("Reviewer concern: Too salesy.");
  });
  it("still fails when the draft breaks a hard rule, whatever the reviewer says", async () => {
    const banned = JSON.stringify({ parts: ["I hope this finds you well"] });
    const engine: AiEngine = { async complete({ prompt }) { return prompt.startsWith("You check a draft") ? '{"ok": true}' : banned; } };
    await expect(draftFirstDm(db, engine, leadId, "")).rejects.toThrow(/acceptable dm draft/);
  });
  it("tells the reviewer what it may accept about the sender", async () => {
    const prompts: string[] = [];
    const engine: AiEngine = { async complete({ prompt }) { prompts.push(prompt); return prompt.startsWith("You check a draft") ? '{"ok": true}' : good; } };
    await draftFirstDm(db, engine, leadId, "bio: coach");
    const review = prompts.find((p) => p.startsWith("You check a draft"))!;
    expect(review).toContain("Rudra at Infyum");
    expect(review).toContain("based in India");
    expect(review).toContain("claims about the sender are fine");
  });
  it("lets a draft through when the reviewer's answer cannot be read or the reviewer call fails", () => {
    expect(parseVerdict("I think it is fine")).toEqual({ ok: true });
    expect(parseVerdict("{broken")).toEqual({ ok: true });
    expect(parseVerdict('{"ok": true}')).toEqual({ ok: true });
    expect(parseVerdict('{"ok": false}')).toMatchObject({ ok: false });
    expect(parseVerdict('Sure! {"ok": false, "problem": "Criticises the bio."} done')).toEqual({ ok: false, problem: "Criticises the bio." });
  });
});

