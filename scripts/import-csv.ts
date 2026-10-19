// One-time (and safe to repeat) import of the old spreadsheet. Existing handles are skipped.
//   npx tsx scripts/import-csv.ts "<path to engaged.csv>"
import fs from "node:fs";
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { addLead, moveStage, scheduleFollowup, setNotes } from "@/lib/db/repos/leads";
import { logActivity } from "@/lib/db/repos/activity";
import type { Stage } from "@/lib/domain/stages";

/** Small CSV reader that handles quoted fields and commas/newlines inside quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const SKIP_REASON: Record<string, string> = {
  skipped_existing_thread: "Already had a conversation before import",
  not_qualified: "Did not qualify",
  do_not_send_non_US: "Not based in the US",
  blocked_no_message_requests: "Account does not accept message requests",
};

const file = process.argv[2];
if (!file) { console.error("Usage: tsx scripts/import-csv.ts <engaged.csv>"); process.exit(1); }

const db = openDb(config.dbPath);
const rows = parseCsv(fs.readFileSync(file, "utf8"));
let created = 0, skippedExisting = 0;

db.transaction(() => {
  for (const r of rows) {
    if (!r.handle) continue;
    const followers = Number(r.followers.replace(/[^0-9]/g, "")) || null;
    const { created: isNew, lead } = addLead(db, {
      handle: r.handle, followers, niche: r.niche,
      country: r.us_based === "yes" ? "United States" : null, source: "import",
    }, "import");
    if (!isNew) { skippedExisting++; continue; }
    created++;

    let target: Stage = "found";
    const note: string[] = [];
    if (r.dm_status === "sent") target = r.replied.startsWith("yes") || r.stage.startsWith("S3") ? "replied" : "dm_sent";
    else if (SKIP_REASON[r.dm_status]) target = "skipped";
    else if (r.dm_status) note.push(`Old status "${r.dm_status}" could not be verified. Check the inbox.`);

    // Walk the legal path so the activity log reads like real history.
    const path: Stage[] = ["qualified", "warmed", "dm_sent", "replied"];
    if (target === "skipped") moveStage(db, lead.id, "skipped", "import", SKIP_REASON[r.dm_status]);
    else for (const s of path) {
      if (target === "found") break;
      moveStage(db, lead.id, s, "import");
      if (s === target) break;
    }

    if (r.dm_status === "sent" && r.dm_final) {
      const parts = r.dm_final.split("||").map((p) => p.trim().replace(/^\d\)\s*/, ""));
      db.prepare("INSERT INTO messages (lead_id, direction, kind, parts, status, sent_at) VALUES (?,?,?,?,?,?)")
        .run(lead.id, "out", "dm", JSON.stringify(parts), "sent", r.sent_date || null);
      if (r.followup_due && target === "dm_sent") scheduleFollowup(db, lead.id, `${r.followup_due} 12:00:00`, 0);
    }
    if (r.replied.startsWith("yes")) note.push(`Reply: ${r.replied}`);
    if (note.length) setNotes(db, lead.id, note.join("\n"));
  }
  logActivity(db, "import", "import.csv", { detail: `${created} new, ${skippedExisting} already present` });
})();

console.log(`Imported ${created} leads, ${skippedExisting} already present.`);
