// Run with: npm run worker
// Keeps working through due jobs. Stop it any time with Ctrl+C: unfinished jobs are re-queued on the next start.
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { requeueStuck } from "@/lib/db/repos/jobs";
import { defaultEngine } from "@/lib/engine";
import { PlaywrightInstagram } from "./instagram";
import { planWork, runOne, type Deps } from "./runner";

const db = openDb(config.dbPath);
const requeued = requeueStuck(db);
if (requeued) console.log(`Re-queued ${requeued} unfinished job(s).`);

const deps: Deps = {
  db, engine: defaultEngine(), driver: new PlaywrightInstagram(), now: () => new Date(),
  pace: () => new Promise((r) => setTimeout(r, 60_000 + Math.random() * 120_000)), // 1 to 3 minutes between sends
};

let stopping = false;
process.on("SIGINT", () => { stopping = true; console.log("Stopping after the current job…"); });

(async () => {
  console.log("Worker running. Press Ctrl+C to stop.");
  while (!stopping) {
    try {
      planWork(deps);
      const didWork = await runOne(deps);
      if (!didWork) await new Promise((r) => setTimeout(r, 15_000));
    } catch (e) {
      console.error("Worker error:", e);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  process.exit(0);
})();
