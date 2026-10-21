"use server";
import { spawn } from "node:child_process";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { createAccount, getAccount, setAccountCap, setAccountStatus } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { normHandle } from "@/lib/db/repos/dnc";
import { workerStatus } from "@/lib/queries/worker-status";
import { loginWindowCommand } from "@/lib/services/login-window-command";
import type { ActionResult } from "@/lib/ui/action-result";
import { accountIdSchema, capSchema, connectSchema } from "./validation";

function startLoginWindow(accountId: number, jobId: number): boolean {
  if (process.env.OUTREACH_SMOKE_DIST_DIR) return true;
  try {
    const command = loginWindowCommand(accountId, jobId);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(), detached: true, stdio: "ignore",
      env: {
        PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: process.env.NODE_ENV ?? "development",
        DB_PATH: config.dbPath, PROFILES_DIR: config.profilesDir,
      },
    });
    child.once("error", () => {
      try {
        const db = getDb();
        db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'")
          .run("The sign-in window could not start. Try again from Accounts.", jobId);
      } catch { /* The next page load still shows the queued request. */ }
    });
    child.unref();
    return child.pid !== undefined;
  } catch {
    return false;
  }
}
type LoginRequest = { jobId: number; launch: boolean; alreadyOpening: boolean };
function requestLogin(db: ReturnType<typeof getDb>, accountId: number, backgroundRunning: boolean): LoginRequest {
  const active = db.prepare("SELECT id,status,created_at FROM jobs WHERE type='open_login' AND account_id=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1")
    .get(accountId) as { id: number; status: string; created_at: string } | undefined;
  if (active?.status === "running") {
    const created = Date.parse(`${active.created_at.replace(" ", "T")}Z`);
    if (Number.isFinite(created) && Date.now() - created < 20 * 60_000) return { jobId: active.id, launch: false, alreadyOpening: true };
    db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'")
      .run("The previous sign-in window stopped responding. Try again.", active.id);
  }
  const jobId = active?.status === "queued" ? active.id : enqueue(db, { type: "open_login", accountId });
  if (backgroundRunning) return { jobId, launch: false, alreadyOpening: false };
  const claim = db.prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=? AND status='queued'").run(jobId);
  return { jobId, launch: claim.changes === 1, alreadyOpening: false };
}
export async function connectAccount(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = connectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  const handle = normHandle(parsed.data.handle), db = getDb();
  if (db.prepare("SELECT id FROM ig_accounts WHERE handle=?").get(handle)) return { error: "This account is already saved. Use its Open login window button below.", field: "handle" };
  const backgroundRunning = Boolean(process.env.OUTREACH_SMOKE_DIST_DIR) || workerStatus(db, new Date()).running;
  let accountId = 0, request: LoginRequest = { jobId: 0, launch: false, alreadyOpening: false };
  db.transaction(() => {
    const account = createAccount(db, { handle, profileDir: path.join(config.profilesDir, handle), dailyCap: parsed.data.dailyCap }, user.email);
    accountId = account.id;
    request = requestLogin(db, account.id, backgroundRunning);
  }).immediate();
  const smoke = Boolean(process.env.OUTREACH_SMOKE_DIST_DIR);
  const started = !request.launch || startLoginWindow(accountId, request.jobId);
  if (!started) db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'").run("The sign-in window could not start. Try again from Accounts.", request.jobId);
  revalidatePath("/accounts");
  if (!started) return { error: "The account was saved, but its sign-in window could not open. Try again from the account below." };
  return { message: smoke ? "Account saved. The browser check uses a queued sign-in request." : "Instagram is opening in a separate window. Sign in there by hand, then close the window." };
}
export async function reopenLogin(form: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = accountIdSchema.safeParse(form.get("id"));
  const account = parsed.success ? getAccount(getDb(), parsed.data) : null;
  if (!account) return { error: "Account not found. Refresh this page." };
  const db = getDb();
  const backgroundRunning = Boolean(process.env.OUTREACH_SMOKE_DIST_DIR) || workerStatus(db, new Date()).running;
  let request: LoginRequest = { jobId: 0, launch: false, alreadyOpening: false };
  db.transaction(() => {
    request = requestLogin(db, account.id, backgroundRunning);
  }).immediate();
  const started = !request.launch || startLoginWindow(account.id, request.jobId);
  if (!started) db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'").run("The sign-in window could not start. Try again from Accounts.", request.jobId);
  revalidatePath("/accounts");
  if (!started) return { error: "The sign-in window could not open. Try again shortly." };
  if (request.alreadyOpening) return { message: "The sign-in window is already opening. Finish there before requesting another." };
  return { message: process.env.OUTREACH_SMOKE_DIST_DIR ? "Sign-in request saved for the browser check." : "Instagram is opening in a separate window. Sign in there by hand, then close the window." };
}
export async function changeStatus(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(form.get("id")), status = form.get("status");
  if (!parsed.success || (status !== "active" && status !== "paused")) return { error: "Choose a valid account action." };
  const account = getAccount(getDb(), parsed.data);
  if (!account) return { error: "Account not found. Refresh this page." };
  if (account.status === "blocked") return { error: "Instagram showed a warning. This account stays stopped; resolve it in Instagram and have the warning reviewed before resuming." };
  setAccountStatus(getDb(), parsed.data, status, status === "paused" ? "Paused by team" : "", user.email);
  revalidatePath("/accounts"); return { message: status === "paused" ? "Account paused." : "Account resumed. Working hours and daily limits still apply." };
}
export async function changeCap(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = accountIdSchema.safeParse(form.get("id")), cap = capSchema.safeParse(form.get("cap"));
  if (!id.success || !getAccount(getDb(), id.data)) return { error: "Account not found. Refresh this page." };
  if (!cap.success) return { error: `Choose a whole-number limit from 1 to ${config.absoluteDailyCeiling}.`, field: "cap" };
  setAccountCap(getDb(), id.data, cap.data, user.email);
  revalidatePath("/accounts"); return { message: "Daily limit saved. The gradual ramp-up still applies." };
}
