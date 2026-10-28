import { expect, it } from "vitest";
import { DEFAULT_WRITING, fillDmPrompt, parseWritingSettings, writingFromForm } from "@/lib/domain/writing-settings";
import { commentPrompt, firstDmPrompt, systemPrompt } from "@/lib/engine/prompts";

const ctx = { handle: "synthetic", niche: "", followers: null, profileNotes: "", audienceText: "", recentOpenings: [], portfolioLink: "https://example.com/x" };

it("defaults keep today's wording", () => {
  expect(parseWritingSettings(null)).toEqual(DEFAULT_WRITING);
  expect(systemPrompt()).toContain("Rudra at Infyum");
  expect(firstDmPrompt(ctx)).toContain("introduce yourself by name as Rudra at Infyum");
  expect(firstDmPrompt(ctx)).toContain("https://example.com/x");
});

it("edited sender details and prompts reach the writer", () => {
  const parsed = writingFromForm({ senderName: "Sam", company: "Acme", location: "Canada", offer: "a funnel studio", dmPrompt: "Say hi as {sender} from {company}. Link: {link}", commentPrompt: "Short and kind." });
  if ("error" in parsed) throw new Error(parsed.error.message);
  expect(systemPrompt(parsed.writing)).toContain("Sam at Acme, a funnel studio based in Canada");
  expect(firstDmPrompt({ ...ctx, writing: parsed.writing })).toContain("Say hi as Sam from Acme. Link: https://example.com/x");
  expect(commentPrompt("A post", [], parsed.writing.commentPrompt)).toMatch(/^Short and kind\./);
  expect(parseWritingSettings(JSON.stringify(parsed.writing))).toEqual(parsed.writing);
});

it("blank fields fall back, and a DM prompt without the link is refused", () => {
  const blank = writingFromForm({});
  expect("writing" in blank && blank.writing).toEqual(DEFAULT_WRITING);
  expect(writingFromForm({ dmPrompt: "No link here" })).toMatchObject({ error: { field: "dmPrompt" } });
  expect(fillDmPrompt("{sender}/{company}/{location}/{offer}", DEFAULT_WRITING, "l")).toContain("Rudra/Infyum/India");
});
