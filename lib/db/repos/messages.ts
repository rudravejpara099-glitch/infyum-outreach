import type { Db } from "../core";
import type { Campaign, Message, MessageKind, MessageStatus } from "../types";
import { decideApproval } from "@/lib/domain/approval";
import { checkAgainstRecent } from "@/lib/domain/similarity";
import { logActivity } from "./activity";

const map = (r: Record<string, unknown>): Message => ({
  id: r.id as number, leadId: r.lead_id as number, accountId: r.account_id as number | null,
  direction: r.direction as Message["direction"], kind: r.kind as MessageKind,
  parts: JSON.parse(r.parts as string) as string[], status: r.status as MessageStatus,
  approvalReasons: JSON.parse(r.approval_reasons as string) as string[],
  createdAt: r.created_at as string, sentAt: r.sent_at as string | null,
});

/** Text of the last N things we sent, used by the similarity guard. */
export function recentSentTexts(db: Db, limit = 10): string[] {
  const rows = db.prepare("SELECT parts FROM messages WHERE direction='out' AND status='sent' ORDER BY id DESC LIMIT ?").all(limit) as { parts: string }[];
  return rows.map((r) => (JSON.parse(r.parts) as string[]).join(" "));
}

export type DraftInput = {
  leadId: number; accountId: number | null; kind: Exclude<MessageKind, "incoming">;
  parts: string[]; campaign: Pick<Campaign, "approvalRequired">; incomingText?: string;
};

/** Stores an outgoing draft and decides, in one place, whether a human must approve it. */
export function createOutgoing(db: Db, input: DraftInput, actor: string): Message {
  const joined = input.parts.join(" ");
  const similar = checkAgainstRecent(joined, recentSentTexts(db));
  const decision = decideApproval({
    campaignApprovalRequired: input.campaign.approvalRequired,
    incoming: input.incomingText, outgoing: joined, similarityFlag: similar.tooSimilar,
  });
  const status: MessageStatus = decision.needsApproval ? "pending_approval" : "approved";
  const info = db.prepare(
    "INSERT INTO messages (lead_id, account_id, direction, kind, parts, status, approval_reasons) VALUES (?,?,?,?,?,?,?)",
  ).run(input.leadId, input.accountId, "out", input.kind, JSON.stringify(input.parts), status, JSON.stringify(decision.reasons));
  const msg = getMessage(db, Number(info.lastInsertRowid))!;
  logActivity(db, actor, `message.${status}`, { leadId: input.leadId, accountId: input.accountId, detail: decision.reasons.join("; ") });
  return msg;
}

export function recordIncoming(db: Db, leadId: number, accountId: number | null, text: string): Message {
  const info = db.prepare(
    "INSERT INTO messages (lead_id, account_id, direction, kind, parts, status, sent_at) VALUES (?,?,?,?,?,?,datetime('now'))",
  ).run(leadId, accountId, "in", "incoming", JSON.stringify([text]), "sent");
  logActivity(db, "worker", "message.received", { leadId, accountId });
  return getMessage(db, Number(info.lastInsertRowid))!;
}

export function getMessage(db: Db, id: number): Message | null {
  const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
export function listMessages(db: Db, f: { leadId?: number; status?: MessageStatus; limit?: number } = {}): Message[] {
  const where: string[] = []; const args: unknown[] = [];
  if (f.leadId) { where.push("lead_id = ?"); args.push(f.leadId); }
  if (f.status) { where.push("status = ?"); args.push(f.status); }
  const sql = `SELECT * FROM messages ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, f.limit ?? 300) as Record<string, unknown>[]).map(map);
}

export function approveMessage(db: Db, id: number, actor: string, editedParts?: string[]): void {
  const m = getMessage(db, id);
  if (!m || m.status !== "pending_approval") throw new Error("Message is not waiting for approval");
  db.prepare("UPDATE messages SET status='approved', parts = ? WHERE id = ?").run(JSON.stringify(editedParts ?? m.parts), id);
  logActivity(db, actor, "message.approved_by_human", { leadId: m.leadId, accountId: m.accountId });
}
export function rejectMessage(db: Db, id: number, actor: string): void {
  const m = getMessage(db, id);
  if (!m || m.status !== "pending_approval") throw new Error("Message is not waiting for approval");
  db.prepare("UPDATE messages SET status='rejected' WHERE id = ?").run(id);
  logActivity(db, actor, "message.rejected", { leadId: m.leadId, accountId: m.accountId });
}
export function markSent(db: Db, id: number): void {
  db.prepare("UPDATE messages SET status='sent', sent_at=datetime('now') WHERE id = ?").run(id);
}
export function markFailed(db: Db, id: number, reason: string): void {
  const m = getMessage(db, id);
  db.prepare("UPDATE messages SET status='failed' WHERE id = ?").run(id);
  if (m) logActivity(db, "worker", "message.failed", { leadId: m.leadId, accountId: m.accountId, detail: reason });
}

/** Messages that count against the daily limit: first DMs and follow-ups. Replies do not. */
export function sentTodayForAccount(db: Db, accountId: number, dateIso: string): number {
  return (db.prepare(
    "SELECT COUNT(*) c FROM messages WHERE account_id = ? AND direction='out' AND status='sent' AND kind IN ('dm','followup') AND date(sent_at) = ?",
  ).get(accountId, dateIso) as { c: number }).c;
}
export function approvedQueue(db: Db): Message[] {
  return (db.prepare("SELECT * FROM messages WHERE direction='out' AND status='approved' ORDER BY id").all() as Record<string, unknown>[]).map(map);
}
