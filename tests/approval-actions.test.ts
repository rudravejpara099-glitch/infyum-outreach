import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { createOutgoing, getMessage } from "@/lib/db/repos/messages";
import { approve } from "@/app/(app)/approvals/actions";
const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ email: "test@example.test" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: Db, campaignId: number, accountId: number;
const parts = ["Your weekly workshop has a practical structure.", "I’m Rudra at Infyum, a small team in India. https://portfolio.infyum.com/sales-funnel", "How do people book a call after a workshop?"];
beforeEach(() => { db = openDb(":memory:"); state.db = db; accountId = createAccount(db, { handle: "sender", profileDir: "/tmp/sender" }, "test").id; campaignId = createCampaign(db, { name: "Approval", niches: [], audienceText: "", country: "United States", minFollowers: 2000, maxFollowers: 150000, approvalRequired: true, followupsEnabled: true }, [accountId], "test").id; });
afterEach(() => { db.close(); state.db = null; });
function draft(stage: "found" | "qualified" | "warmed" | "dm_sent", kind: "dm" | "followup" = "dm") {
  const lead = addLead(db, { handle: stage, campaignId, stage }, "test").lead;
  const message = createOutgoing(db, { leadId: lead.id, accountId, kind, parts: kind === "dm" ? parts : ["Your workshop also made me think about the next step. What would help?"], campaign: { approvalRequired: true } }, "test");
  const form = new FormData(); form.set("id", String(message.id)); message.parts.forEach(part => form.append("part", part));
  return { lead, message, form };
}
it("refuses a first DM before checks and warm-up, and after it was already sent", async () => {
  for (const stage of ["found", "qualified", "dm_sent"] as const) {
    const { message, form } = draft(stage);
    expect((await approve(form)).error).toBeTruthy();
    expect(getMessage(db, message.id)?.status).toBe("pending_approval");
  }
});
it("allows a valid first DM for a warmed lead", async () => {
  const { message, form } = draft("warmed");
  expect((await approve(form)).error).toBeUndefined(); expect(getMessage(db, message.id)?.status).toBe("approved");
});
it("does not approve drafts from a finished campaign", async () => {
  const { message, form } = draft("warmed");
  setCampaignStatus(db, campaignId, "done", "test");
  expect((await approve(form)).error).toMatch(/campaign is finished/i);
  expect(getMessage(db, message.id)?.status).toBe("pending_approval");
});
it("does not approve drafts after their sender is removed from the campaign", async () => {
  const { message, form } = draft("warmed");
  db.prepare("DELETE FROM campaign_accounts WHERE campaign_id=? AND account_id=?").run(campaignId, accountId);
  expect((await approve(form)).error).toMatch(/sender is no longer assigned/i);
  expect(getMessage(db, message.id)?.status).toBe("pending_approval");
});
it("refuses follow-ups before contact, when disabled or after the maximum", async () => {
  const before = draft("warmed", "followup");
  expect((await approve(before.form)).error).toBeTruthy();
  const later = draft("dm_sent", "followup");
  db.prepare("UPDATE campaigns SET followups_enabled=0 WHERE id=?").run(campaignId);
  expect((await approve(later.form)).error).toBeTruthy();
  db.prepare("UPDATE campaigns SET followups_enabled=1 WHERE id=?").run(campaignId);
  db.prepare("UPDATE leads SET followups_sent=2 WHERE id=?").run(later.lead.id);
  expect((await approve(later.form)).error).toBeTruthy();
  expect(getMessage(db, later.message.id)?.status).toBe("pending_approval");
});

it("bulk approval refuses missing review confirmation and stale batches without partial approval", async () => {
  const { approveSelected } = await import("@/app/(app)/approvals/actions");
  const first = draft("warmed");
  const second = draft("found");
  const form = new FormData();
  for (const item of [first, second]) { form.append("selected", String(item.message.id)); item.message.parts.forEach(part => form.append(`part-${item.message.id}`, part)); }
  expect((await approveSelected(form)).error).toBeTruthy();
  form.set("reviewed", "on");
  expect((await approveSelected(form)).error).toBeTruthy();
  expect(getMessage(db, first.message.id)?.status).toBe("pending_approval");
});
it("bulk approval rechecks edited sensitive text and similarity instead of trusting stored badges", async () => {
  const { approveSelected } = await import("@/app/(app)/approvals/actions");
  const first = draft("warmed");
  const form = new FormData(); form.set("reviewed", "on"); form.append("selected", String(first.message.id));
  first.message.parts.forEach((part, index) => form.append(`part-${first.message.id}`, index === 2 ? "What is the price you would pay?" : part));
  expect((await approveSelected(form)).error).toBeTruthy();
  expect(getMessage(db, first.message.id)?.status).toBe("pending_approval");
});
it("bulk approval saves the exact reviewed edits for eligible drafts", async () => {
  const { approveSelected } = await import("@/app/(app)/approvals/actions");
  const first = draft("warmed");
  const form = new FormData(); form.set("reviewed", "on"); form.append("selected", String(first.message.id));
  first.message.parts.forEach((part, index) => form.append(`part-${first.message.id}`, index === 0 ? "Your weekly workshop explores practical goal setting." : part));
  expect((await approveSelected(form)).error).toBeUndefined();
  expect(getMessage(db, first.message.id)).toMatchObject({ status: "approved", parts: ["Your weekly workshop explores practical goal setting.", parts[1], parts[2]] });
});
it("refuses two similar edited drafts in one selection atomically", async () => {
  const { approveSelected } = await import("@/app/(app)/approvals/actions");
  const first = draft("warmed");
  const lead = addLead(db, { handle: "second.warmed", campaignId, stage: "warmed" }, "test").lead;
  const second = createOutgoing(db, { leadId: lead.id, accountId, kind: "dm", parts, campaign: { approvalRequired: true } }, "test");
  const form = new FormData(); form.set("reviewed", "on");
  for (const message of [first.message, second]) { form.append("selected", String(message.id)); parts.forEach(part => form.append(`part-${message.id}`, part)); }
  expect((await approveSelected(form)).error).toMatch(/individual review/);
  expect(getMessage(db, first.message.id)?.status).toBe("pending_approval"); expect(getMessage(db, second.id)?.status).toBe("pending_approval");
});
it("does not let a forged selection bypass stored human-review flags", async () => {
  const { approveSelected } = await import("@/app/(app)/approvals/actions"); const item = draft("warmed");
  db.prepare("UPDATE messages SET approval_reasons=? WHERE id=?").run(JSON.stringify(["Mentions price"]), item.message.id);
  const form = new FormData(); form.set("reviewed", "on"); form.append("selected", String(item.message.id)); parts.forEach(part => form.append(`part-${item.message.id}`, part));
  expect((await approveSelected(form)).error).toMatch(/individual review/);
  expect(getMessage(db, item.message.id)?.status).toBe("pending_approval");
});
it("rejects empty, duplicate, unsafe and oversized selections", async () => {
  const { approveSelected } = await import("@/app/(app)/approvals/actions");
  for (const ids of [[], ["0"], ["1", "1"], ["9007199254740992"], Array.from({ length: 101 }, (_, i) => String(i + 1))]) {
    const form = new FormData(); form.set("reviewed", "on"); ids.forEach(id => form.append("selected", id));
    expect((await approveSelected(form)).error).toBeTruthy();
  }
});
