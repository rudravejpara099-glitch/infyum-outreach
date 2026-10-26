import { expect, it } from "vitest";
import { campaignWritingGuidance } from "@/lib/domain/campaign-writing-guidance";

it("explains that available local writing can prepare automatically without paid billing", () => {
  const text = campaignWritingGuidance({ provider: "local", available: true });
  expect(text).toContain("prepare comments and message drafts automatically without a paid API");
  expect(text).toContain("approval setting");
  expect(text).not.toContain("spending limit");
});
it("holds preparation when local writing is offline without suggesting a paid fallback", () => {
  const text = campaignWritingGuidance({ provider: "local", available: false });
  expect(text).toContain("waiting for the free writing service");
  expect(text).toContain("No paid writing is used instead");
  expect(text).not.toContain("automatically without");
});
it("retains paid-writing budget gates even when a provider key is configured", () => {
  const text = campaignWritingGuidance({ provider: "anthropic", available: true });
  expect(text).toContain("require an approved spending limit");
  expect(text).toContain("approval setting");
});
it("offers setup and actual engagement for an unconfigured writer without inventing readiness", () => {
  expect(campaignWritingGuidance({ provider: "anthropic", available: false })).toContain("After real engagement");
  expect(campaignWritingGuidance({ provider: "invalid", available: false })).toContain("waiting for writing setup");
});
