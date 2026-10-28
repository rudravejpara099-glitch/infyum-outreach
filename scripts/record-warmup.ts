// Run with: npx tsx scripts/record-warmup.ts <leadId> <notes>. Marks a hand-driven warm-up done and drafts the first DM with the app's writer.
import { loadEnvConfig } from "@next/env";
import { openDb } from "@/lib/db/core";
import { config } from "@/lib/config";
import { moveStage } from "@/lib/db/repos/leads";
import { logActivity } from "@/lib/db/repos/activity";
import { defaultEngine } from "@/lib/engine";
import { draftFirstDm } from "@/lib/services/drafting";

loadEnvConfig(process.cwd());
const [id, notes = ""] = process.argv.slice(2);
const db = openDb(config.dbPath);
const leadId = Number(id);
moveStage(db, leadId, "warmed", "worker");
logActivity(db, "worker", "lead.warmed_up", { leadId, detail: "10 likes, 10 comments, followed: true (driven through the Chrome extension)" });
draftFirstDm(db, defaultEngine(), leadId, notes, "worker").then((m) => {
  console.log(JSON.stringify({ messageId: m.id, status: m.status, parts: m.parts }, null, 2));
  db.close();
}).catch((e) => { console.error(String(e)); db.close(); process.exitCode = 1; });
