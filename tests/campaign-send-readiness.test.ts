import { describe, expect, it } from "vitest";
import type { IgAccount } from "@/lib/db/types";
import { campaignSendBlockers, chromeWarmupNotice } from "@/lib/ui/campaign-send-readiness";

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

  it("explains when qualified leads are waiting on a Chrome-only warm-up step", () => {
    const sender = account({ id: 2, handle: "chrome.sender", browserMode: "chrome_read_only" });
    expect(chromeWarmupNotice([sender], [2], 3)).toEqual({ accountHandles: ["chrome.sender"], matchedLeadCount: 3 });
    expect(chromeWarmupNotice([sender], [2], 0)).toBeNull();
    expect(chromeWarmupNotice([sender], [2], -1)).toBeNull();
  });

  it("does not show the warm-up notice when any active selected sender supports the full flow", () => {
    const chrome = account({ id: 2, handle: "chrome.sender", browserMode: "chrome_read_only" });
    const isolated = account({ id: 3, handle: "isolated.sender", browserMode: "isolated" });
    expect(chromeWarmupNotice([chrome, isolated], [2, 3], 3)).toBeNull();
    expect(chromeWarmupNotice([chrome, { ...isolated, status: "paused" }], [2, 3], 3)).toEqual({
      accountHandles: ["chrome.sender"], matchedLeadCount: 3,
    });
  });

  it("does not show a warm-up notice without a selected active Chrome sender", () => {
    const chrome = account({ id: 2, browserMode: "chrome_read_only" });
    expect(chromeWarmupNotice([chrome], [], 3)).toBeNull();
    expect(chromeWarmupNotice([{ ...chrome, status: "paused" }], [2], 3)).toBeNull();
  });
});
