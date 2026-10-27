// Run with: npm run doctor. Checks everything a run needs and says exactly what to fix. Reads only, changes nothing.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { openDb } from "@/lib/db/core";
import { config } from "@/lib/config";

loadEnvConfig(process.cwd());
let bad = 0;
const ok = (msg: string) => console.log(`  ok   ${msg}`);
const fail = (msg: string, fix: string) => { bad++; console.log(`  FIX  ${msg}\n         -> ${fix}`); };
const count = (pattern: string) => {
  try { return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).split("\n").filter(Boolean).length; } catch { return 0; }
};
const get = async (url: string) => {
  try { return await fetch(url, { signal: AbortSignal.timeout(3000) }); } catch { return null; }
};

async function main(): Promise<void> {
  console.log("Outreach doctor\n");
  const provider = process.env.AI_PROVIDER ?? "local";
  if (provider === "local") {
    const model = process.env.LOCAL_AI_MODEL ?? "";
    const r = await get("http://127.0.0.1:11434/api/tags");
    if (!r) fail("Local writer (Ollama) is not running", "ollama serve   (or: brew services start ollama)");
    else {
      const names = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [];
      if (names.includes(model)) ok(`Local writer ready (${model})`);
      else fail(`Model ${model || "(none set)"} is not installed (installed: ${names.join(", ") || "none"})`, `set LOCAL_AI_MODEL in .env.local to an installed model, or run: ollama pull ${model || "qwen2.5:7b"}`);
    }
  } else ok(`Writer provider: ${provider}`);

  if (await get("http://127.0.0.1:3000/login")) ok("Web app is up on port 3000");
  else fail("Web app is not running", "npm start");

  const debugFile = `${homedir()}/Library/Application Support/Google/Chrome/DevToolsActivePort`;
  if (existsSync(debugFile)) ok("Chrome remote debugging is on");
  else fail("Chrome remote debugging is off", "in the signed-in Chrome open chrome://inspect/#remote-debugging and switch it on");

  const workers = count("worker/index.ts");
  if (workers === 0) ok("No worker running (start one with: npm run worker)");
  else if (workers <= 2) ok("One worker running");
  else fail(`${workers} worker processes running`, "pkill -f worker/index.ts, then start exactly one");

  const db = openDb(config.dbPath);
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const failed = one("SELECT count(*) n FROM jobs WHERE status='failed' AND created_at > datetime('now','-1 day')");
  if (failed === 0) ok("No failed jobs in the last day");
  else fail(`${failed} failed job(s) in the last day`, "see Activity in the app; failed warm-ups stay stopped on purpose because they may have partly commented");
  const stuck = one(`SELECT count(*) n FROM leads l WHERE l.stage IN ('found','qualified','warmed')
    AND EXISTS (SELECT 1 FROM jobs j WHERE j.lead_id=l.id AND j.status='failed')
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.lead_id=l.id AND j.status IN ('queued','running'))`);
  if (stuck === 0) ok("No leads stuck behind a failed job");
  else fail(`${stuck} lead(s) stuck behind a failed job`, "review in the app, then re-queue the safe ones (qualify is read-only and safe to repeat)");
  db.close();

  console.log(bad ? `\n${bad} thing(s) to fix before a run.` : "\nAll clear. Safe to start the worker.");
  process.exitCode = bad ? 1 : 0;
}
main();
