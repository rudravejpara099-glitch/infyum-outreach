import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { addLead, assignLead, getLead } from "@/lib/db/repos/leads";
import { addDnc } from "@/lib/db/repos/dnc";
import { createAccount } from "@/lib/db/repos/accounts";
import { listMessages } from "@/lib/db/repos/messages";
import { changeStage, createManualFirstDm } from "@/app/(app)/leads/actions";
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

function manualDmForm(leadId: number) {
  const value = new FormData();
  value.set("id", String(leadId));
  value.set("part1", "I saw your recent post about business funding.");
  value.set("part2", "I noticed a gap in your booking funnel: https://portfolio.infyum.com/sales-funnel");
  value.set("part3", "How do you handle new enquiries today?");
  return value;
}

function readyManualLead() {
  const account = createAccount(db, { handle: "chrome-sender", profileDir: "/tmp/chrome", browserMode: "chrome_read_only" }, "test");
  const campaign = createCampaign(db, { name: "Manual DM", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [account.id], "test");
  setCampaignStatus(db, campaign.id, "active", "test");
  const lead = addLead(db, { handle: "manual-target", campaignId: campaign.id, stage: "warmed" }, "test").lead;
  assignLead(db, lead.id, campaign.id, account.id);
  return lead;
}

it("creates a manual first DM in approval review for a warmed Chrome lead without paid AI", async () => {
  const lead = readyManualLead();
  expect((await createManualFirstDm(manualDmForm(lead.id))).message).toMatch(/review and approve/i);
  const [message] = listMessages(db, { leadId: lead.id });
  expect(message).toMatchObject({ direction: "out", kind: "dm", status: "pending_approval", accountId: getLead(db, lead.id)?.accountId });
  expect((await createManualFirstDm(manualDmForm(lead.id))).error).toMatch(/already exists/);
  expect(listMessages(db, { leadId: lead.id })).toHaveLength(1);
});

it("refuses a manual first DM when approval is off, the lead is not ready, or contact is blocked", async () => {
  const lead = readyManualLead();
  db.prepare("UPDATE campaigns SET approval_required=0 WHERE id=?").run(lead.campaignId);
  expect((await createManualFirstDm(manualDmForm(lead.id))).error).toMatch(/Turn on message approval/);
  db.prepare("UPDATE campaigns SET approval_required=1 WHERE id=?").run(lead.campaignId);
  db.prepare("UPDATE leads SET stage='qualified' WHERE id=?").run(lead.id);
  expect((await createManualFirstDm(manualDmForm(lead.id))).error).toMatch(/mark it ready/);
  db.prepare("UPDATE leads SET stage='warmed' WHERE id=?").run(lead.id);
  addDnc(db, "manual-target");
  expect((await createManualFirstDm(manualDmForm(lead.id))).error).toMatch(/Do not contact/);
});
