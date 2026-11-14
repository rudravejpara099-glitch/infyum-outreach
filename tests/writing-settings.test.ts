import { expect, it } from "vitest";
import { DEFAULT_DM_PROMPT, DEFAULT_WRITING, fillDmPrompt, parseWritingSettings, writingFromForm } from "@/lib/domain/writing-settings";
import { commentPrompt, firstDmPrompt, systemPrompt } from "@/lib/engine/prompts";

const ctx = { handle: "synthetic", niche: "", followers: null, profileNotes: "", audienceText: "", recentOpenings: [], portfolioLink: "https://example.com/x" };

it("defaults use the INFYUM DM guidelines", () => {
  expect(parseWritingSettings(null)).toEqual(DEFAULT_WRITING);
  expect(systemPrompt()).toContain("Sunil at INFYUM");
  const prompt = firstDmPrompt(ctx);
  expect(prompt).toContain("ONE first Instagram DM from Sunil at INFYUM");
  expect(prompt).toContain("free 2-minute Loom audit");
  expect(prompt).toContain("SKIP");
  expect(prompt).not.toContain("India");
  expect(prompt).not.toContain("https://example.com/x");
});

it("edited sender details and prompts reach the writer", () => {
  const parsed = writingFromForm({ senderName: "Sam", company: "Acme", location: "Canada", offer: "a funnel studio", dmPrompt: "Say hi as {sender} from {company}.", commentPrompt: "Short and kind." });
  if ("error" in parsed) throw new Error(parsed.error.message);
  expect(systemPrompt(parsed.writing)).toContain("Sam at Acme");
  expect(firstDmPrompt({ ...ctx, writing: parsed.writing })).toContain("Say hi as Sam from Acme.");
  expect(commentPrompt("A post", [], parsed.writing.commentPrompt)).toMatch(/^Short and kind\./);
  expect(parseWritingSettings(JSON.stringify(parsed.writing))).toEqual(parsed.writing);
});

it("blank fields fall back, and a DM prompt saved under the old link contract is ignored", () => {
  const blank = writingFromForm({});
  expect("writing" in blank && blank.writing).toEqual(DEFAULT_WRITING);
  const legacy = JSON.stringify({ ...DEFAULT_WRITING, dmPrompt: "Message 2: introduce yourself. Link exactly once: {link}" });
  expect(parseWritingSettings(legacy).dmPrompt).toBe(DEFAULT_DM_PROMPT);
  expect(fillDmPrompt("{sender}/{company}/{location}/{offer}", DEFAULT_WRITING, "l")).toContain("Sunil/INFYUM/India");
});
