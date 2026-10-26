"use server";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { workspaceWorkerEnv } from "@/lib/domain/workspace-rules";
import { getWorkspacePaths } from "@/lib/workspaces/storage";
import { getDb } from "@/lib/db";
import { workerStatus } from "@/lib/queries/worker-status";
import { failWorkerLaunch, requestWorkerStop, reserveWorker } from "@/lib/services/worker-lifecycle";
import { workerStartProblem } from "@/lib/services/worker-start-readiness";
import type { ActionResult } from "@/lib/ui/action-result";

function localControlAllowed(): boolean {
  return process.env.VERCEL !== "1" && process.env.BILLING_DEPLOYMENT !== "hosted" && process.env.OUTREACH_SMOKE_MODE !== "1";
}

export async function startWorker(form: FormData = new FormData()): Promise<ActionResult> {
  const user = await requireUser();
  if (!localControlAllowed()) return { error: "Start Outreach from the local app on this computer." };
  const db = (await getDb(form));
  const paths = getWorkspacePaths(user.workspaceId);
  const problem = workerStartProblem(db);
  if (problem) return { error: problem };
  if (workerStatus(db, new Date()).phase === "legacy_running") return { error: "An older background service is already running. Stop it in its terminal first." };
  const token = reserveWorker(db);
  if (!token) return { message: "Outreach is already starting or running. Check its status below." };
  try {
    // Errors from the background service go to a private log beside the workspace database.
    const log = openSync(`${paths.dbPath}.worker.log`, "a");
    const child = spawn(process.execPath, ["--import", "tsx", path.join(process.cwd(), "worker", "index.ts")], {
      cwd: process.cwd(), detached: true, stdio: ["ignore", log, log],
      env: { ...workspaceWorkerEnv(process.env, paths.hostChromeAllowed), DB_PATH: paths.dbPath, PROFILES_DIR: paths.profilesDir, OUTREACH_HOST_CHROME_ALLOWED: paths.hostChromeAllowed ? "1" : "0", OUTREACH_WORKER_LEASE_TOKEN: token },
    });
    child.once("error", () => { try { failWorkerLaunch(db, token); } catch { /* Status will show the timed-out start. */ } });
    if (!child.pid) { failWorkerLaunch(db, token); return { error: "Outreach could not start. Try again." }; }
    child.unref();
    revalidatePath("/");
    return { message: "Outreach is starting. Check the status in a moment." };
  } catch {
    failWorkerLaunch(db, token);
    return { error: "Outreach could not start. Try again." };
  }
}

export async function stopWorker(form: FormData = new FormData()): Promise<ActionResult> {
  await requireUser();
  if (!localControlAllowed()) return { error: "Stop Outreach from the local app on this computer." };
  const db = (await getDb(form));
  if (workerStatus(db, new Date()).phase === "legacy_running") return { error: "This background service was started in a terminal. Stop it there." };
  const phase = requestWorkerStop(db);
  revalidatePath("/");
  return { message: phase === "stopped" ? "Outreach is stopped." : "Outreach is stopping after its current task finishes. No new tasks will start." };
}
