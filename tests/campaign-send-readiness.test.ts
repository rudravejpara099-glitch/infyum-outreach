import { describe, expect, it } from "vitest";
import type { IgAccount } from "@/lib/db/types";
import { campaignSendBlockers } from "@/lib/ui/campaign-send-readiness";

const account = (overrides: Partial<IgAccount>): IgAccount => ({
  id: 1, handle: "sender", label: "", profileDir: "profile", browserMode: "isolated",
  dailyCap: 35, rampStart: "2026-01-01", status: "active", statusNote: "", ...overrides,
});

describe("campaign sender readiness", () => {
  it("treats an active signed-in Chrome sender as campaign-ready", () => {
    expect(campaignSendBlockers([
      account({ status: "paused" }),
      account({ id: 2, handle: "chrome.sender", browserMode: "chrome_read_only" }),
    ], [2])).toEqual([]);
    expect(campaignSendBlockers([account({ status: "paused" })], [1])).toEqual([
      "@sender is paused",
      "No active Instagram account is ready for campaign actions",
    ]);
  });

  it("does not offer a blocked account as ready or warn when a send-capable account is selected", () => {
    expect(campaignSendBlockers([account({ status: "blocked" })], [1])).toEqual([
      "@sender is stopped after an Instagram warning",
      "No active Instagram account is ready for campaign actions",
    ]);
    expect(campaignSendBlockers([account({ id: 2 })], [1, 2])).toEqual([]);
    expect(campaignSendBlockers([account({ browserMode: "chrome_read_only" })], [1])).toEqual([]);
  });

  it("identifies an active campaign-capable account that is not selected", () => {
    expect(campaignSendBlockers([
      account({ status: "paused" }),
      account({ id: 2, handle: "available.sender", browserMode: "chrome_read_only" }),
    ], [1])).toEqual(["@sender is paused", "@available.sender can run campaigns but isn’t selected"]);
  });

  it("leaves the no-selected-sender explanation to the existing campaign UI", () => {
    expect(campaignSendBlockers([account({})], [])).toEqual([]);
  });
});
