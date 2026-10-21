import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead, getLead } from "@/lib/db/repos/leads";
import { addDnc } from "@/lib/db/repos/dnc";
import { changeStage } from "@/app/(app)/leads/actions";
const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ email: "test@example.test" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: Db, id: number;
function form() { const value = new FormData(); value.set("id", String(id)); value.set("to", "found"); return value; }
beforeEach(() => {
  db = openDb(":memory:"); state.db = db;
  const campaign = createCampaign(db, { name: "Recheck", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [], "test");
  id = addLead(db, { handle: "recheck", campaignId: campaign.id, stage: "skipped" }, "test").lead.id;
});
afterEach(() => { db.close(); state.db = null; });
it("allows skipped to found and explains when checking will resume", async () => {
  expect((await changeStage(form())).message).toMatch(/checks/i);
  expect(getLead(db, id)?.stage).toBe("found");
});
it("refuses to restart do-not-contact leads", async () => {
  addDnc(db, "recheck"); expect((await changeStage(form())).error).toBeTruthy(); expect(getLead(db, id)?.stage).toBe("skipped");
});
it("refuses to restart previously contacted leads or leads without a campaign", async () => {
  db.prepare("INSERT INTO messages(lead_id,direction,kind,parts,status) VALUES (?,'out','dm','[]','sent')").run(id);
  expect((await changeStage(form())).error).toBeTruthy();
  db.prepare("DELETE FROM messages WHERE lead_id=?").run(id);
  db.prepare("UPDATE leads SET campaign_id=NULL WHERE id=?").run(id);
  expect((await changeStage(form())).error).toBeTruthy(); expect(getLead(db, id)?.stage).toBe("skipped");
});
