import { describe, expect, it } from "vitest";
import { canMove, canSendAtStage } from "@/lib/domain/stages";
import { qualify } from "@/lib/domain/qualify";
import { dailyAllowance, remainingToday } from "@/lib/domain/limits";
import { checkAgainstRecent } from "@/lib/domain/similarity";
import { decideApproval } from "@/lib/domain/approval";

const rules = { minFollowers: 2000, maxFollowers: 150000, country: "United States" };
const good = {
  isPublic: true, country: "United States", followers: 5000,
  linkedToInfyum: false, alreadyContacted: false, onDoNotContact: false,
};

describe("stages", () => {
  it("allows the normal path and blocks skipping ahead", () => {
    expect(canMove("found", "qualified")).toBe(true);
    expect(canMove("found", "dm_sent")).toBe(false);
    expect(canMove("found", "replied")).toBe(true);
    expect(canMove("closed", "found")).toBe(false);
    expect(canMove("skipped", "found")).toBe(true);
    expect(canMove("skipped", "replied")).toBe(true);
  });
  it("only sends a first DM before first contact and follow-ups while waiting for a reply", () => {
    expect(canSendAtStage("warmed", "dm")).toBe(true);
    expect(canSendAtStage("dm_sent", "followup")).toBe(true);
    for (const stage of ["found", "qualified", "replied", "closed", "skipped"] as const) {
      expect(canSendAtStage(stage, "dm")).toBe(false);
      expect(canSendAtStage(stage, "followup")).toBe(false);
    }
    expect(canSendAtStage("replied", "reply")).toBe(false);
  });
});

describe("qualify", () => {
  it("passes a good lead", () => expect(qualify(good, rules).ok).toBe(true));
  it("fails each rule with its own reason", () => {
    expect(qualify({ ...good, isPublic: false }, rules)).toEqual({ ok: false, reason: "Account is private" });
    expect(qualify({ ...good, country: null }, rules).ok).toBe(false);
    expect(qualify({ ...good, country: "India" }, rules)).toEqual({ ok: false, reason: "Based in India" });
    expect(qualify({ ...good, followers: 1999 }, rules).ok).toBe(false);
    expect(qualify({ ...good, followers: 150001 }, rules).ok).toBe(false);
    expect(qualify({ ...good, linkedToInfyum: true }, rules).ok).toBe(false);
    expect(qualify({ ...good, alreadyContacted: true }, rules).ok).toBe(false);
    expect(qualify({ ...good, onDoNotContact: true }, rules).ok).toBe(false);
  });
  it("reports the first problem only", () => {
    const v = qualify({ ...good, onDoNotContact: true, followers: 5 }, rules);
    expect(v).toEqual({ ok: false, reason: "On the do-not-contact list" });
  });
});

describe("limits", () => {
  const acct = { status: "active" as const, dailyCap: 35, rampStart: "2026-10-01" };
  it("ramps up new accounts, then uses the cap", () => {
    expect(dailyAllowance(acct, "2026-10-01")).toBe(10);
    expect(dailyAllowance(acct, "2026-10-04")).toBe(20);
    expect(dailyAllowance(acct, "2026-10-08")).toBe(35);
  });
  it("never exceeds the cap, even during ramp", () => {
    expect(dailyAllowance({ ...acct, dailyCap: 5 }, "2026-10-01")).toBe(5);
  });
  it("is zero when paused or blocked", () => {
    expect(dailyAllowance({ ...acct, status: "paused" }, "2026-10-20")).toBe(0);
    expect(dailyAllowance({ ...acct, status: "blocked" }, "2026-10-20")).toBe(0);
  });
  it("subtracts what was already sent today and never goes negative", () => {
    expect(remainingToday(acct, "2026-10-20", 30)).toBe(5);
    expect(remainingToday(acct, "2026-10-20", 99)).toBe(0);
  });
});

describe("similarity guard", () => {
  const old = "Your score jump reels with the side by side bureau numbers are the kind people actually save.";
  it("blocks the same opening", () => {
    expect(checkAgainstRecent("Your score jump reels with the totally different ending here", [old]).tooSimilar).toBe(true);
  });
  it("blocks heavy overlap", () => {
    expect(checkAgainstRecent("Honestly " + old.toLowerCase(), [old]).tooSimilar).toBe(true);
  });
  it("lets a fresh message through and ignores links", () => {
    expect(checkAgainstRecent("The 5% Rule reel explains something most people never hear. https://x.com/a", [old]).tooSimilar).toBe(false);
  });
});

describe("approval decision", () => {
  it("requires approval when the campaign says so", () => {
    expect(decideApproval({ campaignApprovalRequired: true, outgoing: "Thanks for the reply." }).needsApproval).toBe(true);
  });
  it("lets a plain reply through when approval is off", () => {
    expect(decideApproval({ campaignApprovalRequired: false, incoming: "Sounds interesting, tell me more", outgoing: "Happy to, what do you sell?" }).needsApproval).toBe(false);
  });
  it("always stops price, contract and partnership talk, even with approval off", () => {
    const d = decideApproval({ campaignApprovalRequired: false, incoming: "How much does it cost?", outgoing: "Depends on scope." });
    expect(d.needsApproval).toBe(true);
    expect(d.reasons).toContain("Mentions price");
    expect(decideApproval({ campaignApprovalRequired: false, outgoing: "We do white label work." }).needsApproval).toBe(true);
  });
  it("flags a similar message", () => {
    expect(decideApproval({ campaignApprovalRequired: false, outgoing: "Hi", similarityFlag: true }).needsApproval).toBe(true);
  });
});
