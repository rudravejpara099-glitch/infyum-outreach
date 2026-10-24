import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";

const KEY = "worker_control";
const START_TIMEOUT_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

export type WorkerPhase = "starting" | "running" | "stopping" | "unresponsive" | "stopped";
type Lease = { token: string; pid: number | null; phase: "starting" | "running" | "stopping" | "stopped"; updatedAt: string };
export type WorkerControl = { phase: WorkerPhase; pid: number | null; updatedAt: string | null };
type IsAlive = (pid: number) => boolean;

export const processIsAlive: IsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
};

function read(db: Db): Lease | null {
  const raw = getSetting(db, KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Lease>;
    if (typeof value.token === "string" && typeof value.updatedAt === "string" &&
      (value.pid === null || Number.isSafeInteger(value.pid)) &&
      (value.phase === "starting" || value.phase === "running" || value.phase === "stopping" || value.phase === "stopped")) return value as Lease;
  } catch { /* Invalid state must not silently allow another worker. */ }
  throw new Error("Background service ownership needs review before starting.");
}

function save(db: Db, value: Lease): void { setSetting(db, KEY, JSON.stringify(value)); }

export function workerControl(db: Db, now = new Date(), isAlive: IsAlive = processIsAlive): WorkerControl {
  const lease = read(db);
  if (!lease || lease.phase === "stopped") return { phase: "stopped", pid: null, updatedAt: lease?.updatedAt ?? null };
  if (lease.pid !== null && !isAlive(lease.pid)) return { phase: "stopped", pid: null, updatedAt: lease.updatedAt };
  const age = now.getTime() - Date.parse(lease.updatedAt);
  if (lease.pid === null && age > START_TIMEOUT_MS) return { phase: "stopped", pid: null, updatedAt: lease.updatedAt };
  if (lease.phase === "running" && age > HEARTBEAT_TIMEOUT_MS) return { phase: "unresponsive", pid: lease.pid, updatedAt: lease.updatedAt };
  return { phase: lease.phase, pid: lease.pid, updatedAt: lease.updatedAt };
}

/** Reserve ownership before spawning or re-queuing any jobs. SQLite serializes competing callers. */
export function reserveWorker(db: Db, now = new Date(), isAlive: IsAlive = processIsAlive): string | null {
  return db.transaction(() => {
    const lease = read(db);
    if (lease && workerControl(db, now, isAlive).phase !== "stopped") return null;
    if (!lease) {
      const legacyHeartbeat = getSetting(db, "worker_heartbeat");
      if (legacyHeartbeat && now.getTime() - Date.parse(legacyHeartbeat) < HEARTBEAT_TIMEOUT_MS) return null;
    }
    const token = randomUUID();
    save(db, { token, pid: null, phase: "starting", updatedAt: now.toISOString() });
    return token;
  }).immediate();
}

/** Only the reserved child may become the worker. A superseded child must exit. */
export function adoptWorker(db: Db, token: string, pid: number, now = new Date()): boolean {
  return db.transaction(() => {
    const lease = read(db);
    if (!lease || lease.token !== token || lease.phase !== "starting" || lease.pid !== null ||
      now.getTime() - Date.parse(lease.updatedAt) > START_TIMEOUT_MS) return false;
    save(db, { ...lease, pid, phase: "running", updatedAt: now.toISOString() });
    return true;
  }).immediate();
}

export function heartbeatWorker(db: Db, token: string, pid: number, now = new Date()): "running" | "stopping" | null {
  return db.transaction(() => {
    const lease = read(db);
    if (!lease || lease.token !== token || lease.pid !== pid || (lease.phase !== "running" && lease.phase !== "stopping")) return null;
    save(db, { ...lease, updatedAt: now.toISOString() });
    return lease.phase;
  }).immediate();
}

/** Called inside the job-claim transaction so Stop and a new claim cannot cross. */
export function workerMayClaim(db: Db, token: string, pid: number): boolean {
  const lease = read(db);
  return lease?.token === token && lease.pid === pid && lease.phase === "running";
}

/** Stop is a durable request; the worker drains its current job rather than being killed. */
export function requestWorkerStop(db: Db, now = new Date()): WorkerPhase {
  return db.transaction(() => {
    const lease = read(db);
    if (!lease) return "stopped";
    if (workerControl(db, now).phase === "stopped" || lease.pid === null) {
      save(db, { ...lease, pid: null, phase: "stopped", updatedAt: now.toISOString() });
      return "stopped";
    }
    if (lease.phase === "stopping") return "stopping";
    save(db, { ...lease, phase: "stopping", updatedAt: now.toISOString() });
    return "stopping";
  }).immediate();
}

export function markOwnedWorkerStopping(db: Db, token: string, pid: number, now = new Date()): void {
  db.transaction(() => {
    const lease = read(db);
    if (lease?.token === token && lease.pid === pid && lease.phase === "running")
      save(db, { ...lease, phase: "stopping", updatedAt: now.toISOString() });
  }).immediate();
}

export function releaseWorker(db: Db, token: string, pid: number | null, now = new Date()): void {
  db.transaction(() => {
    const lease = read(db);
    if (lease?.token === token && (lease.pid === pid || (pid === null && lease.pid === null)))
      save(db, { ...lease, pid: null, phase: "stopped", updatedAt: now.toISOString() });
  }).immediate();
}

/** A failed spawn may only clear its own, still-unadopted reservation. */
export function failWorkerLaunch(db: Db, token: string, now = new Date()): void {
  db.transaction(() => {
    const lease = read(db);
    if (lease?.token === token && lease.phase === "starting" && lease.pid === null)
      save(db, { ...lease, phase: "stopped", updatedAt: now.toISOString() });
  }).immediate();
}
