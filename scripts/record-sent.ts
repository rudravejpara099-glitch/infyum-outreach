// Run with: npx tsx scripts/record-sent.ts <messageId>. Marks a hand-sent first DM as sent and moves the lead to dm_sent.
import { loadEnvConfig } from "@next/env";
import { openDb } from "@/lib/db/core";
import { config } from "@/lib/config";
import { approveMessage, getMessage, markSent } from "@/lib/db/repos/messages";
import { moveStage } from "@/lib/db/repos/leads";
import { logActivity } from "@/lib/db/repos/activity";

loadEnvConfig(process.cwd());
const db = openDb(config.dbPath);
const id = Number(process.argv[2]);
const message = getMessage(db, id);
if (!message) throw new Error("No such message");
if (message.status === "pending_approval") approveMessage(db, id, "owner");
markSent(db, id);
moveStage(db, message.leadId, "dm_sent", "worker");
logActivity(db, "worker", "message.sent", { leadId: message.leadId, accountId: message.accountId, detail: "3 messages, sent through the Chrome extension" });
db.close();
console.log("recorded");
