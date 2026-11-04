// Switches on paid Claude writing for the owner. Spends nothing. Usage:
//   npm run setup:claude -- --limit 10 [--apify-cap 5] [--pause-campaigns] [--user 1] --yes
// Without --yes it only shows what it would do.
import { execFileSync } from "node:child_process";
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { setupClaude } from "@/lib/services/setup-claude";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const limit = arg("limit");
if (!limit) { console.error("Say how much you are happy to spend a month on Claude and Apify together, for example: npm run setup:claude -- --limit 10 --yes"); process.exit(1); }
const db = openDb(config.dbPath);
const userId = Number(arg("user") ?? process.env.BILLING_OWNER_USER_ID ?? (db.prepare("SELECT min(id) id FROM users").get() as { id: number | null }).id);
let commitSha = "unknown";
try { commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }

console.log(`\nPaid Claude writing, for user ${userId}:`);
console.log(`  monthly limit   $${limit}  (new paid work pauses at 90% of it)`);
if (arg("apify-cap")) console.log(`  Apify search    $${arg("apify-cap")} a month`);
console.log("  you will pay for: every campaign and every Instagram account in this app");
if (!flag("yes")) { console.log("\nThis was only a preview. Nothing changed. Add --yes to do it.\n"); process.exit(0); }

const result = setupClaude(db, { userId, limitUsd: limit, apifyCapUsd: arg("apify-cap"), pauseCampaigns: flag("pause-campaigns"), commitSha });
db.close();
if (!result.ok) { console.error(`\nNot done: ${result.error}\n`); process.exit(1); }
console.log("\nDone:");
for (const step of result.steps) console.log(`  - ${step}`);
console.log("\nNext: add ANTHROPIC_API_KEY to .env.local (make sure AI_PROVIDER=local is not set), restart (npm run restart), then run npm run ready.\n");
