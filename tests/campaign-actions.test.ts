import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign, getCampaign, setCampaignAccounts, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { createAccount } from "@/lib/db/repos/accounts";
import { setSetting } from "@/lib/db/repos/settings";
import { addLeads, changeCampaignStatus, deleteEmptyDraftCampaign, findLeads } from "@/app/(app)/campaigns/actions";

const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ id: 1, email: "test@example.test" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: Db, campaignId: number;
beforeEach(() => {
  db = openDb(":memory:"); state.db = db;
  campaignId = createCampaign(db, { name: "Finished", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 10000, approvalRequired: true, followupsEnabled: true }, [], "test").id;
  setCampaignStatus(db, campaignId, "done", "test");
});
afterEach(() => { vi.unstubAllEnvs(); db.close(); state.db = null; });

it("does not allow a finished campaign to be restarted by a forged form", async () => {
  const form = new FormData(); form.set("id", String(campaignId)); form.set("status", "active");
  expect((await changeCampaignStatus(form)).error).toMatch(/finished/i);
  expect(getCampaign(db, campaignId)?.status).toBe("done");
});
it("refuses new leads or searches on a finished campaign", async () => {
  const form = new FormData(); form.set("id", String(campaignId)); form.set("handles", "someone.new");
  expect((await addLeads(form)).error).toMatch(/finished/i);
  expect((await findLeads(form)).error).toMatch(/finished/i);
  expect(db.prepare("SELECT count(*) n FROM leads").get()).toEqual({ n: 0 });
});
it("requires an active campaign before a lead search can be queued", async () => {
  db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(campaignId);
  const form = new FormData(); form.set("id", String(campaignId));
  expect((await findLeads(form)).error).toMatch(/start this campaign/i);
  expect(db.prepare("SELECT count(*) n FROM jobs").get()).toEqual({ n: 0 });
});

it("does not queue a lead search when Apify is disconnected", async () => {
  vi.stubEnv("APIFY_TOKEN", "");
  const account = createAccount(db, { handle: "sender.test", profileDir: "/tmp/sender.test", dailyCap: 10 }, "test");
  setCampaignAccounts(db, campaignId, [account.id]);
  setCampaignStatus(db, campaignId, "active", "test");
  setSetting(db, "apify_monthly_cap_usd", "1");
  const form = new FormData(); form.set("id", String(campaignId));
  expect((await findLeads(form)).error).toMatch(/not connected/i);
  expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='find_leads'").get()).toEqual({ n: 0 });
});

it("deletes only an empty draft and records the change", async () => {
  const draftId = createCampaign(db, { name: "Empty draft", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 10000, approvalRequired: true, followupsEnabled: true }, [], "test").id;
  const form = new FormData(); form.set("id", String(draftId));
  expect(await deleteEmptyDraftCampaign(form)).toMatchObject({ message: "Empty draft deleted.", url: "/campaigns" });
  expect(getCampaign(db, draftId)).toBeNull();
  expect(db.prepare("SELECT action, detail FROM activity WHERE action='campaign.deleted'").get()).toEqual({ action: "campaign.deleted", detail: "Empty draft" });
});

it("keeps campaigns that are not empty drafts", async () => {
  const draftId = createCampaign(db, { name: "Has history", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 10000, approvalRequired: true, followupsEnabled: true }, [], "test").id;
  db.prepare("INSERT INTO leads(handle,campaign_id) VALUES('history.lead',?)").run(draftId);
  for (const id of [campaignId, draftId]) {
    const form = new FormData(); form.set("id", String(id));
    expect((await deleteEmptyDraftCampaign(form)).error).toMatch(/empty draft|has leads/i);
    expect(getCampaign(db, id)).not.toBeNull();
  }
});

it("rejects adding leads from a stale form after an empty draft was deleted", async () => {
  const draftId = createCampaign(db, { name: "Removed draft", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 10000, approvalRequired: true, followupsEnabled: true }, [], "test").id;
  const form = new FormData(); form.set("id", String(draftId)); form.set("handles", "not.orphaned");
  const removeForm = new FormData(); removeForm.set("id", String(draftId));
  expect((await deleteEmptyDraftCampaign(removeForm)).message).toBe("Empty draft deleted.");
  expect((await addLeads(form)).error).toMatch(/campaign not found/i);
  expect(db.prepare("SELECT count(*) n FROM leads WHERE handle='not.orphaned'").get()).toEqual({ n: 0 });
});
