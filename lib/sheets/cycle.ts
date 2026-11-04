import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import type { SheetGateway } from "./gateway";
import { syncFromSheet, type FromSheetResult } from "./from-sheet";
import { SHEET_SYNC_EVERY_MS, syncToSheet, type SyncResult } from "./sync";

export type CycleResult = { fromSheet: FromSheetResult; toSheet: SyncResult };

/** One full round, at most once a minute: first take in what people changed in the Sheet, then write the app's state out.
 * The order matters: writing first would overwrite a teammate's edit before it was read. Returns null when not due. */
export async function runSheetCycle(db: Db, gateway: SheetGateway, now = new Date()): Promise<CycleResult | null> {
  const lastTry = Date.parse(getSetting(db, "sheet_cycle_at") ?? "") || 0;
  if (now.getTime() - lastTry < SHEET_SYNC_EVERY_MS) return null;
  setSetting(db, "sheet_cycle_at", now.toISOString());
  // A brand-new sheet has no tabs to read yet, so create them before the first read.
  if (getSetting(db, "sheet_schema") === null) {
    const first = await syncToSheet(db, gateway, now);
    return { fromSheet: { ok: true, stageChanges: 0, doNotContactAdded: 0, conflicts: 0 }, toSheet: first };
  }
  const fromSheet = await syncFromSheet(db, gateway);
  // If reading failed, do not write over the Sheet this round; the next round retries both.
  const toSheet: SyncResult = fromSheet.ok ? await syncToSheet(db, gateway, now) : { ok: false, error: fromSheet.error };
  return { fromSheet, toSheet };
}
