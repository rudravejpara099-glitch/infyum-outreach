import type { Db } from "../core";
import type { Lead } from "../types";
import { canMove, type Stage } from "@/lib/domain/stages";
import { logActivity } from "./activity";
import { normHandle } from "./dnc";

const map = (r: Record<string, unknown>): Lead => ({
  id: r.id as number, handle: r.handle as string, followers: r.followers as number | null, niche: r.niche as string,
  country: r.country as string | null, source: r.source as string, stage: r.stage as Stage,
  skipReason: r.skip_reason as string, campaignId: r.campaign_id as number | null, accountId: r.account_id as number | null,
  followupsSent: r.followups_sent as number, nextFollowupAt: r.next_followup_at as string | null,
  notes: r.notes as string, fitScore: (r.fit_score as number | null) ?? null, fitReason: (r.fit_reason as string) ?? "", createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

export type NewLead = {
  handle: string; followers?: number | null; niche?: string; country?: string | null;
  source?: string; campaignId?: number | null; stage?: Stage;
};

/** Adds a lead unless that handle already exists anywhere in the app (global dedupe). */
export function addLead(db: Db, input: NewLead, actor: string): { created: boolean; lead: Lead } {
  const handle = normHandle(input.handle);
  const existing = findLeadByHandle(db, handle);
  if (existing) return { created: false, lead: existing };
  const info = db
    .prepare("INSERT INTO leads (handle, followers, niche, country, source, campaign_id, stage) VALUES (?,?,?,?,?,?,?)")
    .run(handle, input.followers ?? null, input.niche ?? "", input.country ?? null, input.source ?? "manual",
      input.campaignId ?? null, input.stage ?? "found");
  const lead = getLead(db, Number(info.lastInsertRowid))!;
  logActivity(db, actor, "lead.added", { leadId: lead.id, detail: `${handle} via ${lead.source}` });
  return { created: true, lead };
}

export function getLead(db: Db, id: number): Lead | null {
  const r = db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
export function findLeadByHandle(db: Db, handle: string): Lead | null {
  const r = db.prepare("SELECT * FROM leads WHERE handle = ?").get(normHandle(handle)) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listLeads(db: Db, f: { stage?: Stage; campaignId?: number; limit?: number } = {}): Lead[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.stage) { where.push("stage = ?"); args.push(f.stage); }
  if (f.campaignId) { where.push("campaign_id = ?"); args.push(f.campaignId); }
  const sql = `SELECT * FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, f.limit ?? 500) as Record<string, unknown>[]).map(map);
}

export function countByStage(db: Db, campaignId?: number): Record<string, number> {
  const rows = (campaignId
    ? db.prepare("SELECT stage, COUNT(*) c FROM leads WHERE campaign_id = ? GROUP BY stage").all(campaignId)
    : db.prepare("SELECT stage, COUNT(*) c FROM leads GROUP BY stage").all()) as { stage: string; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.stage, r.c]));
}

/** The only way a lead changes stage. Illegal jumps throw, so the board can never show nonsense. */
export function moveStage(db: Db, leadId: number, to: Stage, actor: string, note = ""): Lead {
  const lead = getLead(db, leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (lead.stage === to && to !== "replied") return lead;
  if (!canMove(lead.stage, to)) throw new Error(`Cannot move ${lead.handle} from ${lead.stage} to ${to}`);
  db.prepare("UPDATE leads SET stage = ?, skip_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .run(to, to === "skipped" ? note : "", leadId);
  logActivity(db, actor, `lead.${to}`, { leadId, detail: note });
  return getLead(db, leadId)!;
}

export function assignLead(db: Db, leadId: number, campaignId: number | null, accountId: number | null): void {
  db.prepare("UPDATE leads SET campaign_id = ?, account_id = ?, updated_at = datetime('now') WHERE id = ?").run(campaignId, accountId, leadId);
}
export function updateFacts(db: Db, leadId: number, facts: { followers?: number; country?: string | null; niche?: string }): void {
  db.prepare("UPDATE leads SET followers = COALESCE(?, followers), country = COALESCE(?, country), niche = COALESCE(?, niche), updated_at = datetime('now') WHERE id = ?")
    .run(facts.followers ?? null, facts.country ?? null, facts.niche ?? null, leadId);
}
export function setFit(db: Db, leadId: number, score: number, reason: string): void {
  db.prepare("UPDATE leads SET fit_score = ?, fit_reason = ?, updated_at = datetime('now') WHERE id = ?").run(score, reason.slice(0, 300), leadId);
}
export function setNotes(db: Db, leadId: number, notes: string): void {
  db.prepare("UPDATE leads SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(notes, leadId);
}
export function scheduleFollowup(db: Db, leadId: number, atIso: string | null, sentCount?: number): void {
  db.prepare("UPDATE leads SET next_followup_at = ?, followups_sent = COALESCE(?, followups_sent), updated_at = datetime('now') WHERE id = ?")
    .run(atIso, sentCount ?? null, leadId);
}
/** Leads whose follow-up is due and who have not replied. */
export function dueFollowups(db: Db, nowIso: string): Lead[] {
  return (db.prepare("SELECT * FROM leads WHERE stage = 'dm_sent' AND next_followup_at IS NOT NULL AND next_followup_at <= ?").all(nowIso) as Record<string, unknown>[]).map(map);
}
