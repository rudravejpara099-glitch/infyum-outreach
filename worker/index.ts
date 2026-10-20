// Run with: npm run worker
// Keeps working through due jobs. Stop it any time with Ctrl+C: unfinished jobs are re-queued on the next start.
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { requeueStuck } from "@/lib/db/repos/jobs";
import { defaultEngine } from "@/lib/engine";
import { ApifyClient } from "@/lib/leads/apify";
import { PlaywrightInstagram } from "./instagram";
import { currentLanes, planWork, runOne, type Deps } from "./runner";

const db = openDb(config.dbPath);
const requeued = requeueStuck(db);
if (requeued) console.log(`Re-queued ${requeued} unfinished job(s).`);

const deps: Deps = {
  db, engine: defaultEngine(), driver: new PlaywrightInstagram(), now: () => new Date(),
  apify: process.env.APIFY_TOKEN ? new ApifyClient({ token: process.env.APIFY_TOKEN }) : undefined,
  pace: () => new Promise((r) => setTimeout(r, 60_000 + Math.random() * 120_000)), // 1 to 3 minutes between sends
};

let stopping = false;
process.on("SIGINT", () => { stopping = true; console.log("Stopping after the current job…"); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("Worker running, one lane per Instagram account. Press Ctrl+C to stop.");
  const running = new Map<string, Promise<void>>();
  while (!stopping) {
    try {
      planWork(deps);
      for (const lane of currentLanes(db)) {
        const key = String(lane.accountId);
        if (running.has(key)) continue;
        // A lane works through its own jobs one at a time; different accounts run side by side.
        running.set(key, (async () => {
          while (!stopping && (await runOne(deps, lane))) planWork(deps);
        })().catch((e) => console.error(`Lane ${key} error:`, e)).finally(() => running.delete(key)));
      }
    } catch (e) {
      console.error("Worker error:", e);
    }
    await sleep(5_000);
  }
  await Promise.all(running.values());
  process.exit(0);
})();
