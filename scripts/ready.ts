// Says in plain words what is ready and what still needs doing before the first real run. Reads only: sends nothing, spends nothing.
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { evaluateReadiness } from "@/lib/services/readiness";

async function main() {
  let appUp = false;
  try { appUp = (await fetch("http://localhost:3000/login", { redirect: "manual", signal: AbortSignal.timeout(3000) })).status < 500; } catch { /* not running */ }
  const db = openDb(config.dbPath);
  const checks = await evaluateReadiness({ env: process.env, db, fetchImpl: fetch, appUp, nowMs: Date.now() });
  db.close();
  let area = "";
  for (const check of checks) {
    if (check.area !== area) { area = check.area; console.log(`\n${area}`); }
    console.log(`  ${check.status === "ok" ? "OK  " : check.status === "todo" ? "TODO" : "NOTE"}  ${check.message}`);
    if (check.fix && check.status !== "ok") console.log(`        -> ${check.fix}`);
  }
  const todos = checks.filter((c) => c.status === "todo").length;
  console.log(`\n${todos === 0 ? "Everything needed is in place. Press Resume (if stopped), then run a small test with approval on." : `${todos} thing${todos === 1 ? "" : "s"} still to do (marked TODO).`}\n`);
}
void main();
