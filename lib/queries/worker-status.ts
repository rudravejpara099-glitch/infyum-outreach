import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";

const KEY = "worker_heartbeat";
export const STALE_AFTER_MS = 30_000;

/** The worker calls this every loop so the app can tell whether it is alive. */
export function beat(db: Db, now: Date): void {
  setSetting(db, KEY, now.toISOString());
}

export type WorkerStatus = { running: boolean; lastSeen: string | null };

export function workerStatus(db: Db, now: Date): WorkerStatus {
  const lastSeen = getSetting(db, KEY);
  const running = lastSeen != null && now.getTime() - new Date(lastSeen).getTime() < STALE_AFTER_MS;
  return { running, lastSeen };
}
