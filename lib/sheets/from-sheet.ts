import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { findLeadByHandle, moveStage } from "@/lib/db/repos/leads";
import { addDnc, isDnc } from "@/lib/db/repos/dnc";
import { logActivity } from "@/lib/db/repos/activity";
import { markDoNotContact } from "@/lib/services/outreach";
import { canMove } from "@/lib/domain/stages";
import type { SheetGateway } from "./gateway";
import { LEADS_HEADERS, normUsername, SHEET_STAGES, stageFromSheet, STAGE_TO_SHEET } from "./model";

export type FromSheetResult = { ok: true; stageChanges: number; doNotContactAdded: number; conflicts: number; knownNamesBlocked?: number } | { ok: false; error: string };

const clean = (value: unknown) => normUsername(String(value ?? "").replace(/^'/, ""));

/** Sheet to app, so teammates can work from the Sheet. Never throws; a failure is recorded and retried by the next call.
 *
 * Rules (docs/BUILD-SLABS.md, slab 6):
 * - A name added to the Do-not-contact tab blocks that prospect in the app. Removing one in the Sheet does not unblock anyone.
 * - The document's duplicate rule: a username that is in the Sheet's Leads tab but unknown to the app was handled by someone else, so the app blocks it too.
 * - A changed Stage cell moves the lead, but only along the app's allowed transitions; a refused change is logged and the Sheet is put back by the next one-way sync.
 * - If the same lead changed in both places since the last sync, the person's edit in the Sheet wins when the app allows it (the app's own change is already in its activity log); otherwise the app's stage stays. Each conflict gets an `sheet.conflict` log line. */
export async function syncFromSheet(db: Db, gateway: SheetGateway): Promise<FromSheetResult> {
  try {
    const seen = JSON.parse(getSetting(db, "sheet_stage_seen") ?? "{}") as Record<string, string>;
    const stageCol = LEADS_HEADERS.indexOf("stage");
    let stageChanges = 0, conflicts = 0, doNotContactAdded = 0;

    for (const row of await gateway.readRows("Do-not-contact")) {
      const handle = clean(row[0]);
      if (!handle || isDnc(db, handle)) continue;
      const reason = String(row[1] ?? "").trim() || "added in the Sheet";
      const lead = findLeadByHandle(db, handle);
      if (lead) markDoNotContact(db, lead.id, reason, "sheet"); else addDnc(db, handle, reason);
      logActivity(db, "sheet", "sheet.dnc_added", { leadId: lead?.id ?? null, detail: handle });
      doNotContactAdded++;
    }

    let knownNamesBlocked = 0;
    for (const row of await gateway.readRows("Leads")) {
      const handle = clean(row[0]);
      const lead = handle ? findLeadByHandle(db, handle) : null;
      if (handle && !lead && !isDnc(db, handle) && /^[a-z0-9_.]{1,30}$/.test(handle)) {
        addDnc(db, handle, "already in the Sheet");
        logActivity(db, "sheet", "sheet.known_username", { detail: handle });
        knownNamesBlocked++;
      }
      if (!lead) continue;
      const cell = SHEET_STAGES.find((name) => name.toLowerCase() === String(row[stageCol] ?? "").trim().toLowerCase());
      if (!cell) continue;
      const appName = STAGE_TO_SHEET[lead.stage];
      if (cell === appName) { seen[handle] = cell; continue; }
      const sheetEdited = cell !== seen[handle];
      const appChanged = appName !== seen[handle];
      if (!sheetEdited) continue; // only the app changed; the one-way sync will write it
      const targets = stageFromSheet(cell, lead.stage);
      if (appChanged) { conflicts++; logActivity(db, "sheet", "sheet.conflict", { leadId: lead.id, detail: `sheet ${cell}, app ${appName}` }); }
      if (!targets) { seen[handle] = cell; continue; } // a person's own label such as "Call booked": nothing for the app to do
      const target = targets.find((to) => canMove(lead.stage, to));
      if (!target) {
        logActivity(db, "sheet", "sheet.stage_refused", { leadId: lead.id, detail: `${appName} to ${cell}` });
        continue;
      }
      moveStage(db, lead.id, target, "sheet", "changed in the Sheet");
      seen[handle] = cell;
      stageChanges++;
    }

    setSetting(db, "sheet_stage_seen", JSON.stringify(seen));
    return { ok: true, stageChanges, doNotContactAdded, conflicts, knownNamesBlocked };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Sheet read failed";
    setSetting(db, "sheet_sync_error", message);
    return { ok: false, error: message };
  }
}
