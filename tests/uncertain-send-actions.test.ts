import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { createAccount } from "@/lib/db/repos/accounts";
import { createCampaign, setCampaignStatus } from "@/lib/db/repos/campaigns";
import { addLead, getLead } from "@/lib/db/repos/leads";
import { approveMessage, createOutgoing, getMessage, markFailed } from "@/lib/db/repos/messages";
import { enqueue } from "@/lib/db/repos/jobs";
import { resolveUncertainSend } from "@/app/(app)/leads/actions";

const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn(async () => ({ email: "owner@example.test" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: Db, messageId: number, leadId: number;
beforeEach(() => {
  db = openDb(":memory:"); state.db = db;
  const account = createAccount(db, { handle: "sender", profileDir: "/tmp/sender" }, "test");
  const campaign = createCampaign(db, { name: "Recovery", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 10000, approvalRequired: true, followupsEnabled: true }, [account.id], "test");
  setCampaignStatus(db, campaign.id, "active", "test");
  const lead = addLead(db, { handle: "recipient", campaignId: campaign.id, stage: "warmed" }, "test").lead;
  leadId = lead.id; db.prepare("UPDATE leads SET account_id=? WHERE id=?").run(account.id, lead.id);
  const message = createOutgoing(db, { leadId: lead.id, accountId: account.id, kind: "dm", parts: ["Hello", "A second part"], campaign }, "test");
  messageId = message.id; approveMessage(db, message.id, "test");
  markFailed(db, message.id, "A message may have been sent. Check the Instagram conversation before trying again.");
  enqueue(db, { type: "send", leadId: lead.id, accountId: account.id, payload: { messageId: message.id } });
  db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE type='send'").run("A message may have been sent. Check the Instagram conversation before trying again.");
});
afterEach(() => { db.close(); state.db = null; });

function form(decision: "sent" | "unsent", confirmed = false) {
  const value = new FormData(); value.set("id", String(messageId)); value.set("decision", decision);
  if (confirmed) value.set(decision === "sent" ? "confirmedSent" : "confirmedUnsent", "on");
  return value;
}

it("requires an explicit Instagram check before resolving an uncertain send", async () => {
  expect((await resolveUncertainSend(form("unsent"))).error).toMatch(/confirm/i);
  expect(getMessage(db, messageId)?.status).toBe("failed");
});

it("returns a confirmed-unsent message to review without sending it", async () => {
  expect((await resolveUncertainSend(form("unsent", true))).message).toMatch(/Returned to message review/);
  expect(getMessage(db, messageId)).toMatchObject({ status: "pending_approval", approvalReasons: expect.arrayContaining([expect.stringContaining("Owner confirmed no message part was sent")]) });
  expect(getLead(db, leadId)?.stage).toBe("warmed");
});

it("records a confirmed-sent message and advances the lead without resending", async () => {
  expect((await resolveUncertainSend(form("sent", true))).message).toMatch(/Marked sent/);
  expect(getMessage(db, messageId)?.status).toBe("sent");
  expect(getLead(db, leadId)?.stage).toBe("dm_sent");
  expect(db.prepare("SELECT count(*) n FROM jobs WHERE type='send' AND status='queued'").get()).toEqual({ n: 0 });
});
