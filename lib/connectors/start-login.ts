import { spawn } from "node:child_process";
import type { Db } from "@/lib/db/core";
import { getWorkspacePaths } from "@/lib/workspaces/storage";
import { loginWindowCommand } from "@/lib/services/login-window-command";
import { workspaceWorkerEnv } from "@/lib/domain/workspace-rules";

/** A separate process runs only the requested read-only device sign-in check. */
export function launchDeviceLogin(db: Db, workspaceId: string, accountId: number, jobId: number): boolean {
  if (process.env.OUTREACH_SMOKE_MODE === "1") return true;
  const job = db.prepare("SELECT id FROM jobs WHERE id=? AND type='open_login' AND account_id=? AND status='running'").get(jobId, accountId);
  if (!job) return false;
  try {
    const paths = getWorkspacePaths(workspaceId), command = loginWindowCommand(accountId, jobId);
    const child = spawn(command.command, command.args, { cwd: process.cwd(), detached: true, stdio: "ignore", env: workspaceWorkerEnv({
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: process.env.NODE_ENV ?? "development",
      DB_PATH: paths.dbPath, PROFILES_DIR: paths.profilesDir, OUTREACH_HOST_CHROME_ALLOWED: "0",
    }, false) });
    child.once("error", () => { try { db.prepare("UPDATE jobs SET status='failed',last_error='The sign-in check could not start. Try again from Accounts.' WHERE id=? AND status='running'").run(jobId); } catch { /* Request status remains visible. */ } });
    child.unref(); return child.pid !== undefined;
  } catch { return false; }
}
