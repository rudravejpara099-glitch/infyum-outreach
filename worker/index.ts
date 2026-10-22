// Run with: npm run worker. The app's Start control launches the same process.
// A singleton lease is acquired before recovering any interrupted job.
import { config } from "@/lib/config";
import { openDb } from "@/lib/db/core";
import { requeueStuck } from "@/lib/db/repos/jobs";
import { defaultEngine } from "@/lib/engine";
import { ApifyClient } from "@/lib/leads/apify";
import { humanDelayMs } from "@/lib/domain/pacing";
import { beat } from "@/lib/queries/worker-status";
import { adoptWorker, heartbeatWorker, markOwnedWorkerStopping, releaseWorker, reserveWorker, workerMayClaim } from "@/lib/services/worker-lifecycle";
import { AccountInstagramDriver } from "./instagram-driver";
import { currentLanes, planWork, runOne, type Deps } from "./runner";

const db = openDb(config.dbPath);
let token: string | null = null;
let stopping = false;
function stop(): void {
  stopping = true;
  if (token) markOwnedWorkerStopping(db, token, process.pid);
  console.log("Stopping after the current task…");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  token = process.env.OUTREACH_WORKER_LEASE_TOKEN ?? reserveWorker(db);
  if (!token || !adoptWorker(db, token, process.pid)) {
    console.error("Another Outreach background service is starting or running. This process will exit.");
    process.exitCode = 1;
    return;
  }
  try {
    // A second process can never re-queue the first process's in-flight send.
    const requeued = requeueStuck(db);
    if (requeued) console.log(`Recovered ${requeued} interrupted task(s).`);
    const deps: Deps = {
      db, engine: defaultEngine(), driver: new AccountInstagramDriver(), now: () => new Date(),
      apify: process.env.APIFY_TOKEN ? new ApifyClient({ token: process.env.APIFY_TOKEN }) : undefined,
      humanPace: {},
      mayClaim: () => workerMayClaim(db, token!, process.pid),
      pace: () => new Promise((r) => setTimeout(r, humanDelayMs("beforeSend", Math.random))),
    };
    console.log("Outreach is running, one lane per Instagram account.");
    const running = new Map<string, Promise<void>>();
    while (!stopping) {
      try {
        const state = heartbeatWorker(db, token, process.pid);
        if (state !== "running") { stopping = true; break; }
        beat(db, new Date());
        planWork(deps);
        for (const lane of currentLanes(db)) {
          if (stopping || heartbeatWorker(db, token, process.pid) !== "running") { stopping = true; break; }
          const key = String(lane.accountId);
          if (running.has(key)) continue;
          running.set(key, (async () => {
            while (!stopping) {
              if (heartbeatWorker(db, token!, process.pid) !== "running") { stopping = true; break; }
              if (!(await runOne(deps, lane))) break;
              planWork(deps);
            }
          })().catch((error) => console.error(`Lane ${key} error:`, error)).finally(() => running.delete(key)));
        }
      } catch (error) { console.error("Worker error:", error); }
      if (!stopping) await sleep(5_000);
    }
    await Promise.all(running.values());
  } finally {
    releaseWorker(db, token, process.pid);
  }
}

main().catch((error) => { console.error("Worker startup failed:", error); process.exitCode = 1; })
  .finally(() => { db.close(); });
