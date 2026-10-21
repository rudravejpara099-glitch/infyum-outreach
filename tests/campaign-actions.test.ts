import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign, getCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { changeCampaignStatus } from "@/app/(app)/campaigns/actions";

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
afterEach(() => { db.close(); state.db = null; });

it("does not allow a finished campaign to be restarted by a forged form", async () => {
  const form = new FormData(); form.set("id", String(campaignId)); form.set("status", "active");
  expect((await changeCampaignStatus(form)).error).toMatch(/finished/i);
  expect(getCampaign(db, campaignId)?.status).toBe("done");
});
