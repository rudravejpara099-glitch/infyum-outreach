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
import { syncConsentedBilling } from "@/lib/billing";
import { getSheetGateway } from "@/lib/sheets/connection";
import { runSheetCycle } from "@/lib/sheets/cycle";

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
const BILLING_SYNC_INTERVAL_MS = 15 * 60_000;

async function main(): Promise<void> {
  token = process.env.OUTREACH_WORKER_LEASE_TOKEN ?? reserveWorker(db);
  if (!token || !adoptWorker(db, token, process.pid)) {
    console.error("Another Outreach background service is starting or running. This process will exit.");
    process.exitCode = 1;
    return;
  }
  const driver = new AccountInstagramDriver(db);
  try {
    // A second process can never re-queue the first process's in-flight send.
    const requeued = requeueStuck(db);
    if (requeued) console.log(`Checked ${requeued} interrupted task(s).`);
    const deps: Deps = {
      db, engine: defaultEngine(), driver, now: () => new Date(),
      apify: process.env.APIFY_TOKEN ? new ApifyClient({ token: process.env.APIFY_TOKEN }) : undefined,
      // Human pace is ON: working hours, lunch, rests and waits between jobs. The owner briefly switched it off on 2026-11-03
      // and Instagram locked the test account minutes later, so it is back on. HUMAN_PACING=off disables it (not recommended).
      ...(process.env.HUMAN_PACING === "off" ? {} : { humanPace: {} }),
      mayClaim: () => workerMayClaim(db, token!, process.pid),
      pace: () => new Promise((r) => setTimeout(r, humanDelayMs("beforeSend", Math.random))),
    };
    console.log("Outreach is running, one lane per Instagram account.");
    const running = new Map<string, Promise<void>>();
    let lastBillingSyncAt = 0;
    while (!stopping) {
      try {
        const state = heartbeatWorker(db, token, process.pid);
        if (state !== "running") { stopping = true; break; }
        const now = new Date();
        beat(db, now);
        if (now.getTime() - lastBillingSyncAt >= BILLING_SYNC_INTERVAL_MS) {
          const result = syncConsentedBilling(db, now.toISOString());
          if (result.failedUserIds.length) console.error("Periodic billing sync failed for consenting user IDs:", result.failedUserIds.join(", "));
          lastBillingSyncAt = now.getTime();
        }
        // Google Sheet: take in the team's edits, then write ours out; at most once a minute, and a failure never stops outreach.
        const sheet = getSheetGateway(db, { clientId: config.google.clientId, clientSecret: config.google.clientSecret, sessionSecret: config.sessionSecret });
        if (sheet) await runSheetCycle(db, sheet, now).catch((error) => console.error("Sheet sync error:", error instanceof Error ? error.message : error));
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
    try { await driver.close(); }
    finally { releaseWorker(db, token, process.pid); }
  }
}

main().catch((error) => { console.error("Worker startup failed:", error); process.exitCode = 1; })
  .finally(() => { db.close(); });
