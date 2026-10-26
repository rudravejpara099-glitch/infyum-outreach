import { expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/core";
import { runOne } from "@/worker/runner";
import { COMMENT_SYSTEM, commentPrompt, firstDmPrompt } from "@/lib/engine/prompts";
import { warmupCommentError } from "@/lib/domain/warmup-comment";
import { draftWarmupComment } from "@/lib/services/comment-writing";
import type { MeteredAiCall } from "@/lib/engine/types";

it("uses the plain-text comment contract rather than the conflicting DM JSON contract", async () => {
  const db = openDb(":memory:");
  db.exec(`INSERT INTO ig_accounts(id,handle,profile_dir,ramp_start) VALUES(1,'sender','unused','2020-01-01');
    INSERT INTO campaigns(id,name,status) VALUES(1,'Synthetic','active');
    INSERT INTO campaign_accounts(campaign_id,account_id) VALUES(1,1);
    INSERT INTO leads(id,handle,campaign_id,account_id,stage) VALUES(1,'synthetic',1,1,'qualified');
    INSERT INTO jobs(type,lead_id,account_id) VALUES('warmup',1,1);`);
  const complete = vi.fn().mockResolvedValue("The checklist looks helpful 🙌");
  try {
    await runOne({ db, engine: { complete }, now: () => new Date("2026-10-20T10:00:00Z"), pace: async () => {}, driver: {
      openLogin: async () => true, readFacts: vi.fn(), readProfileNotes: vi.fn(), sendMessages: vi.fn(), readInbox: vi.fn(),
      warmUp: async (_account, _handle, _pieces, comment) => {
        const text = await comment("A post with a useful checklist");
        expect(warmupCommentError(text)).toBeNull();
        return { likes: 10, comments: 10, followed: true };
      },
    } });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ system: COMMENT_SYSTEM, prompt: commentPrompt("A post with a useful checklist") }));
    expect(COMMENT_SYSTEM).toContain("only the comment text");
    expect(COMMENT_SYSTEM).not.toContain("JSON only");
    expect(db.prepare("SELECT stage FROM leads WHERE id=1").get()).toEqual({ stage: "warmed" });
  } finally { db.close(); }
});

it("repairs missing emoji with a bounded retry using the specific rejection reason", async () => {
  const complete = vi.fn().mockResolvedValueOnce("The checklist looks helpful").mockResolvedValueOnce("The checklist looks helpful 🙌");
  expect(await draftWarmupComment({ complete }, "A useful checklist")).toBe("The checklist looks helpful 🙌");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[0][0]).toEqual({ system: COMMENT_SYSTEM, prompt: commentPrompt("A useful checklist"), maxOutputTokens: 160, metering: undefined });
  expect(complete.mock.calls[1][0].prompt).toContain("Comments need 1 to 3 emojis.");
});

it("never returns JSON or fenced code even if the words and emoji otherwise qualify", async () => {
  const complete = vi.fn().mockResolvedValueOnce('{"comment":"The checklist looks helpful 🙌"}')
    .mockResolvedValueOnce("```\nThe checklist looks helpful 🙌\n```")
    .mockResolvedValueOnce("The checklist looks helpful 🙌");
  expect(await draftWarmupComment({ complete }, "A checklist")).toBe("The checklist looks helpful 🙌");
  expect(complete).toHaveBeenCalledTimes(3);
  expect(complete.mock.calls[1][0].prompt).toContain("plain text without JSON or code fences");
});

it("stops after three invalid returned drafts without creating a browser interaction", async () => {
  const complete = vi.fn().mockResolvedValue("Too short");
  await expect(draftWarmupComment({ complete }, "A checklist")).rejects.toThrow("after 3 attempts");
  expect(complete).toHaveBeenCalledTimes(3);
});

it("does not retry thrown provider, network or uncertain-operation errors", async () => {
  const failure = new Error("Provider outcome is uncertain");
  const complete = vi.fn().mockRejectedValue(failure);
  await expect(draftWarmupComment({ complete }, "A checklist")).rejects.toBe(failure);
  expect(complete).toHaveBeenCalledTimes(1);
});

it("never reuses a paid operation ID for a validation retry and retains its original attribution", async () => {
  const db = new Proxy({}, { get() { throw new Error("Writing helper must not touch the ledger"); } });
  const metering = { db, userId: 2, operationId: "ai:17:warmup-comment:1", source: { jobId: 17, leadId: 4 }, maxOutputTokens: 1200 } as MeteredAiCall;
  const complete = vi.fn().mockResolvedValueOnce("Missing emoji again").mockResolvedValueOnce("Still missing emoji").mockResolvedValueOnce("The checklist looks helpful 🙌");
  await draftWarmupComment({ complete }, "A checklist", metering);
  expect(complete.mock.calls.map(call => call[0].metering.operationId)).toEqual([
    "ai:17:warmup-comment:1", "ai:17:warmup-comment:1:retry:2", "ai:17:warmup-comment:1:retry:3",
  ]);
  for (const [input] of complete.mock.calls) {
    expect(input.maxOutputTokens).toBe(160);
    expect(input.metering).toMatchObject({ userId: 2, source: { jobId: 17, leadId: 4 }, maxOutputTokens: 160 });
    expect(input.metering.db).toBe(db);
  }
  expect(metering.maxOutputTokens).toBe(1200);
  expect(metering.operationId).toBe("ai:17:warmup-comment:1");
});

it("normalizes surrounding quotes and typographic dashes before validating a returned draft", async () => {
  const complete = vi.fn().mockResolvedValue('  "The checklist — looks helpful 🙌"  ');
  expect(await draftWarmupComment({ complete }, "A checklist")).toBe("The checklist , looks helpful 🙌");
  expect(complete).toHaveBeenCalledTimes(1);
});

it("rejects structured comment shapes as a pure rule", () => {
  for (const value of ['{"comment":"The checklist looks helpful 🙌"}', '["The checklist looks helpful 🙌"]', "```text\nThe checklist looks helpful 🙌\n```", "~~~\nThe checklist looks helpful 🙌\n~~~"]) {
    expect(warmupCommentError(value)).toContain("plain text");
  }
  expect(warmupCommentError("The checklist looks helpful 🙌")).toBeNull();
});

it("includes rejected text and word-count guidance so retries can correct a short comment", async () => {
  const complete = vi.fn().mockResolvedValueOnce("Great tips! 📄✅").mockResolvedValueOnce("Your document checklist looks helpful 📄");
  expect(await draftWarmupComment({ complete }, "A document checklist")).toBe("Your document checklist looks helpful 📄");
  expect(complete.mock.calls[1][0].prompt).toContain('"Great tips! 📄✅"');
  expect(complete.mock.calls[1][0].prompt).toContain("emoji do not count");
  expect(complete.mock.calls[1][0].prompt).toContain("Comments need 3 to 8 words.");
});

it("makes the decided sender identity and direct recipient address explicit in first-contact instructions", () => {
  const prompt = firstDmPrompt({ handle: "synthetic", niche: "", followers: null, profileNotes: "A public checklist", audienceText: "", recentOpenings: [], portfolioLink: "https://portfolio.infyum.com/sales-funnel" });
  expect(prompt).toContain('using "you" or "your"');
  expect(prompt).toContain("MUST include all three names: Rudra, Infyum, India");
});
