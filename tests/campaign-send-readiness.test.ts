import { describe, expect, it } from "vitest";
import type { IgAccount } from "@/lib/db/types";
import { campaignSendBlockers } from "@/lib/ui/campaign-send-readiness";

const account = (overrides: Partial<IgAccount>): IgAccount => ({
  id: 1, handle: "sender", label: "", profileDir: "profile", browserMode: "isolated",
  dailyCap: 35, rampStart: "2026-01-01", status: "active", statusNote: "", ...overrides,
});

describe("campaign sender readiness", () => {
  it("explains paused and read-only selected senders", () => {
    expect(campaignSendBlockers([
      account({ status: "paused" }),
      account({ id: 2, handle: "chrome.sender", browserMode: "chrome_read_only" }),
    ], [1, 2])).toEqual([
      "@sender is paused",
      "@chrome.sender uses signed-in Chrome in read-only mode",
      "No active account is set up for campaign actions",
    ]);
  });

  it("does not offer a blocked account as ready or warn when a send-capable account is selected", () => {
    expect(campaignSendBlockers([account({ status: "blocked" })], [1])).toEqual([
      "@sender is stopped after an Instagram warning",
      "No active account is set up for campaign actions",
    ]);
    expect(campaignSendBlockers([account({ id: 2 })], [1, 2])).toEqual([]);
  });

  it("identifies an active campaign-capable account that is not selected", () => {
    expect(campaignSendBlockers([
      account({ status: "paused" }),
      account({ id: 2, handle: "available.sender" }),
    ], [1])).toEqual(["@sender is paused", "@available.sender can run campaigns but isn’t selected"]);
  });

  it("leaves the no-selected-sender explanation to the existing campaign UI", () => {
    expect(campaignSendBlockers([account({})], [])).toEqual([]);
  });
});
