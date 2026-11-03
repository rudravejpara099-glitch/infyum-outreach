import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { listLeads } from "@/lib/db/repos/leads";
import { listDnc } from "@/lib/db/repos/dnc";
import type { SheetGateway } from "./gateway";
import { HUMAN_ONLY_STAGES, leadExtras, leadRow, LEADS_HEADERS, normUsername, safeCell, SHEET_SETTING_KEYS, STAGE_TO_SHEET, TABS, type Cell } from "./model";

export const SHEET_SYNC_EVERY_MS = 60_000;
const SCHEMA_VERSION = "1";

export type SyncResult = { ok: true; leads: number; activityAdded: number } | { ok: false; error: string };

/** App to Sheet, one way. Never throws: a failure is recorded in Settings and retried on the next call, so outreach is never blocked. */
export async function syncToSheet(db: Db, gateway: SheetGateway, now = new Date()): Promise<SyncResult> {
  try {
    if (getSetting(db, "sheet_schema") !== SCHEMA_VERSION) {
      await gateway.ensureWorkbook(TABS);
      setSetting(db, "sheet_schema", SCHEMA_VERSION);
    }
    const leads = listLeads(db, { limit: 100_000 });
    const byId = new Map(leads.map((l) => [l.id, normUsername(l.handle)]));
    // A person may have marked a handed-over lead "Follow-up due" or "Call booked" in the Sheet; the app has no such stage, so keep it.
    const stageCol = LEADS_HEADERS.indexOf("stage");
    const humanStage = new Map((await gateway.readRows("Leads")).filter((r) => HUMAN_ONLY_STAGES.includes(String(r[stageCol] ?? ""))).map((r) => [normUsername(String(r[0] ?? "").replace(/^'/, "")), String(r[stageCol])]));
    const handedOver = (stage: string) => stage === "dm_sent" || stage === "replied" || stage === "closed";
    await gateway.upsertRows("Leads", 0, leads.map((l) => leadRow(l, leadExtras(db, l.id), handedOver(l.stage) ? humanStage.get(normUsername(l.handle)) : undefined)));
    // Remember the stage each cell now shows, so a later edit in the Sheet can be told apart from an app change.
    setSetting(db, "sheet_stage_seen", JSON.stringify(Object.fromEntries(leads.map((l) => {
      const n = normUsername(l.handle);
      return [n, handedOver(l.stage) ? humanStage.get(n) ?? STAGE_TO_SHEET[l.stage] : STAGE_TO_SHEET[l.stage]];
    }))));

    await gateway.upsertRows("Settings", 0, SHEET_SETTING_KEYS.flatMap((key) => {
      const value = getSetting(db, key);
      return value === null ? [] : [[key, safeCell(value)] as Cell[]];
    }));

    const jobs = db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 500").all() as Record<string, unknown>[];
    await gateway.upsertRows("Jobs", 0, jobs.map((j) => [
      j.id as number, safeCell(j.type as string), safeCell(byId.get(j.lead_id as number) ?? ""), safeCell(j.status as string),
      safeCell(j.run_after as string), j.attempts as number, safeCell(j.last_error as string), safeCell(j.created_at as string),
    ]));

    await gateway.upsertRows("Do-not-contact", 0, listDnc(db).map((d) => [safeCell(d.handle), safeCell(d.reason), safeCell(d.createdAt)]));

    // The activity log only grows, so send just the rows not sent before; the id is written after a successful append.
    const lastId = Number(getSetting(db, "sheet_activity_synced_id") ?? 0);
    const acts = db.prepare("SELECT * FROM activity WHERE id > ? ORDER BY id LIMIT 2000").all(lastId) as Record<string, unknown>[];
    if (acts.length) {
      await gateway.appendRows("Activity Log", acts.map((a) => [
        a.id as number, safeCell(a.ts as string), safeCell(a.actor as string), safeCell(a.action as string),
        safeCell(byId.get(a.lead_id as number) ?? ""), safeCell(a.detail as string),
      ]));
      setSetting(db, "sheet_activity_synced_id", String(acts[acts.length - 1].id));
    }
    setSetting(db, "sheet_synced_at", now.toISOString());
    setSetting(db, "sheet_sync_error", "");
    return { ok: true, leads: leads.length, activityAdded: acts.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Sheet sync failed";
    setSetting(db, "sheet_sync_error", message);
    return { ok: false, error: message };
  }
}

/** Runs the sync at most once a minute. Returns null when it was not due yet. */
export async function syncIfDue(db: Db, gateway: SheetGateway, now = new Date()): Promise<SyncResult | null> {
  const last = Date.parse(getSetting(db, "sheet_synced_at") ?? "") || 0;
  const triedAt = Date.parse(getSetting(db, "sheet_sync_tried_at") ?? "") || 0;
  if (now.getTime() - Math.max(last, triedAt) < SHEET_SYNC_EVERY_MS) return null;
  setSetting(db, "sheet_sync_tried_at", now.toISOString());
  return syncToSheet(db, gateway, now);
}

/** The document's duplicate rule: is this username already in the Sheet (as a lead, or on the do-not-contact tab)? */
export async function sheetKnowsUsername(gateway: SheetGateway, handle: string): Promise<{ lead: boolean; doNotContact: boolean }> {
  const wanted = normUsername(handle);
  const [leads, dnc] = await Promise.all([gateway.readRows("Leads"), gateway.readRows("Do-not-contact")]);
  const has = (rows: string[][]) => rows.some((row) => normUsername(String(row[0] ?? "").replace(/^'/, "")) === wanted);
  return { lead: has(leads), doNotContact: has(dnc) };
}
