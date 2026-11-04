import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { getSetting } from "@/lib/db/repos/settings";
import { billingHold, budgetSnapshot } from "@/lib/billing/budget";
import { integrationReady } from "@/lib/billing/config";
import { payerFor } from "@/lib/billing/attribution";
import { setupClaude } from "@/lib/services/setup-claude";

let db: Db; let userId: number; let campaignId: number; let accountId: number;
const opts = () => ({ userId, limitUsd: "10", commitSha: "abc1234def" });
beforeEach(() => {
  db = openDb(":memory:");
  userId = createUser(db, "owner@test.invalid", "Owner", "fake").id;
  accountId = createAccount(db, { handle: "sender", profileDir: "/tmp/s" }, "t").id;
  campaignId = createCampaign(db, { name: "Test", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 9, approvalRequired: true, followupsEnabled: false }, [accountId], "t").id;
});
afterEach(() => db.close());

describe("one-step Claude setup", () => {
  it("lifts the 'paid work is off' hold: limit, sign-off, and the owner as payer of the campaign and account", () => {
    expect(billingHold(db, userId)).toMatch(/Paid work is off/);
    const result = setupClaude(db, { ...opts(), apifyCapUsd: "5" });
    expect(result.ok).toBe(true);
    expect(budgetSnapshot(db, userId, new Date().toISOString())).toMatchObject({ ceilingMicros: 10_000_000, consent: true });
    expect(integrationReady(db)).toBe(true);
    expect(payerFor(db, "campaign", campaignId)).toBe(userId);
    expect(payerFor(db, "account", accountId)).toBe(userId);
    expect(getSetting(db, "apify_monthly_cap_usd")).toBe("5");
    expect(billingHold(db, userId)).toBeNull();
  });
  it("is safe to run twice", () => {
    expect(setupClaude(db, opts()).ok).toBe(true);
    expect(setupClaude(db, { ...opts(), limitUsd: "20" }).ok).toBe(true);
    expect(budgetSnapshot(db, userId, new Date().toISOString()).ceilingMicros).toBe(20_000_000);
    expect(billingHold(db, userId)).toBeNull();
  });
  it("will not touch a running campaign unless told to pause it, and then pauses it", () => {
    setCampaignStatus(db, campaignId, "active", "t");
    const refused = setupClaude(db, opts());
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toContain("--pause-campaigns");
    expect(integrationReady(db)).toBe(false);
    expect(setupClaude(db, { ...opts(), pauseCampaigns: true }).ok).toBe(true);
    expect(db.prepare("SELECT status FROM campaigns WHERE id=?").get(campaignId)).toEqual({ status: "paused" });
  });
  it("will not run while work is queued or running", () => {
    db.prepare("INSERT INTO jobs(type,status) VALUES('qualify','queued')").run();
    expect(setupClaude(db, opts())).toMatchObject({ ok: false });
    expect(integrationReady(db)).toBe(false);
  });
  it("rejects a missing user, a zero limit and a badly written amount without changing anything", () => {
    expect(setupClaude(db, { ...opts(), userId: 999 })).toMatchObject({ ok: false });
    expect(setupClaude(db, { ...opts(), limitUsd: "0" })).toMatchObject({ ok: false });
    expect(setupClaude(db, { ...opts(), limitUsd: "ten" })).toMatchObject({ ok: false });
    expect(setupClaude(db, { ...opts(), apifyCapUsd: "five" })).toMatchObject({ ok: false });
    expect(integrationReady(db)).toBe(false);
    expect(budgetSnapshot(db, userId, new Date().toISOString()).consent).toBe(false);
  });
  it("is all or nothing: if someone else already pays for the campaign, no limit or sign-off is left behind", () => {
    const other = createUser(db, "other@test.invalid", "Other", "fake").id;
    db.prepare("INSERT INTO billing_assignments VALUES('campaign', ?, ?, ?)").run(campaignId, other, "2026-01-01T00:00:00.000Z");
    const result = setupClaude(db, opts());
    expect(result).toMatchObject({ ok: false });
    expect(integrationReady(db)).toBe(false);
    expect(budgetSnapshot(db, userId, new Date().toISOString())).toMatchObject({ ceilingMicros: 0, consent: false });
    expect(payerFor(db, "account", accountId)).toBeNull();
  });
});
