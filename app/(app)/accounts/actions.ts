"use server";
import { spawn } from "node:child_process";
import { requestIsFromThisComputer } from "@/lib/request-origin";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getAccountDevice } from "@/lib/connectors/commands";
import { requireUser } from "@/lib/auth/dal";
import { getWorkspacePaths } from "@/lib/workspaces/storage";
import { createAccount, getAccount, setAccountBrowserMode, setAccountCap, setAccountStatus } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { normHandle } from "@/lib/db/repos/dnc";
import { workerStatus } from "@/lib/queries/worker-status";
import { getSetting } from "@/lib/db/repos/settings";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import { workerMayOwnJobs } from "@/lib/domain/worker-ownership";
import { loginWindowCommand } from "@/lib/services/login-window-command";
import type { ActionResult } from "@/lib/ui/action-result";
import { accountIdSchema, capSchema, connectSchema } from "./validation";

async function startLoginWindow(db: Awaited<ReturnType<typeof getDb>>, workspaceId: string, accountId: number, jobId: number): Promise<boolean> {
  const paths = getWorkspacePaths(workspaceId);
  if (process.env.OUTREACH_SMOKE_MODE === "1") return true;
  // A sign-in window opens on this computer, so only a person at this computer may open one.
  if (!(await requestIsFromThisComputer())) return false;
  try {
    const command = loginWindowCommand(accountId, jobId);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(), detached: true, stdio: "ignore",
      env: {
        PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: process.env.NODE_ENV ?? "development",
        DB_PATH: paths.dbPath, PROFILES_DIR: paths.profilesDir, OUTREACH_HOST_CHROME_ALLOWED: paths.hostChromeAllowed ? "1" : "0",
      },
    });
    child.once("error", () => {
      try {
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
function queuedLoginMessage(browserMode: "isolated" | "chrome_read_only", phase: ReturnType<typeof workerStatus>["phase"], smoke: boolean): string {
  if (smoke) return browserMode === "chrome_read_only" ? "Account saved. Chrome sign-in check is queued." : "Account saved. Sign-in window check is queued.";
  if (phase === "unresponsive") return "Outreach is taking longer than expected. This sign-in check is saved. Please wait rather than opening another sign-in window.";
  if (phase === "stopping") return "Outreach is closing. This check is saved and will run after Outreach starts again.";
  if (phase === "starting") return "Outreach is starting. This sign-in check is saved and will run when it is ready.";
  return browserMode === "chrome_read_only"
    ? "Account saved. Outreach is checking the current Chrome sign-in."
    : "Instagram is opening in a separate sign-in window. Sign in there, then refresh this page to see the connection status.";
}
function requestLogin(db: Awaited<ReturnType<typeof getDb>>, accountId: number, backgroundOwnsJobs: boolean): LoginRequest {
  const active = db.prepare("SELECT id,status,created_at FROM jobs WHERE type='open_login' AND account_id=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1")
    .get(accountId) as { id: number; status: string; created_at: string } | undefined;
  if (active?.status === "running") {
    const created = Date.parse(`${active.created_at.replace(" ", "T")}Z`);
    if (Number.isFinite(created) && Date.now() - created < 20 * 60_000) return { jobId: active.id, launch: false, alreadyOpening: true };
    db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'")
      .run("The previous sign-in window stopped responding. Try again.", active.id);
  }
  const jobId = active?.status === "queued" ? active.id : enqueue(db, { type: "open_login", accountId });
  if (backgroundOwnsJobs) return { jobId, launch: false, alreadyOpening: false };
  const claim = db.prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=? AND status='queued'").run(jobId);
  return { jobId, launch: claim.changes === 1, alreadyOpening: false };
}
export async function connectAccount(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.hostChromeAllowed) return { url: "/accounts/connect", error: "Connect your own Chrome from the device setup page." };
  const parsed = connectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  if (parsed.data.browserMode === "chrome_read_only" && !user.hostChromeAllowed) return { error: "Use your company's separate Instagram sign-in window.", field: "browserMode" };
  const paths = getWorkspacePaths(user.workspaceId);
  const handle = normHandle(parsed.data.handle), db = (await getDb(form));
  if (db.prepare("SELECT id FROM ig_accounts WHERE handle=?").get(handle)) return { error: "This account is already saved. Use its sign-in button below.", field: "handle" };
  const smoke = process.env.OUTREACH_SMOKE_MODE === "1";
  const worker = workerStatus(db, new Date());
  const backgroundRunning = smoke || workerMayOwnJobs(worker.phase);
  let accountId = 0, request: LoginRequest = { jobId: 0, launch: false, alreadyOpening: false };
  db.transaction(() => {
    const now = new Date();
    const timeZone = getSetting(db, "team_timezone") ?? "America/New_York";
    const account = createAccount(db, { handle, profileDir: path.join(paths.profilesDir, handle), dailyCap: parsed.data.dailyCap, browserMode: parsed.data.browserMode, rampStart: dateInTimeZone(now, timeZone) }, user.email);
    accountId = account.id;
    request = requestLogin(db, account.id, backgroundRunning);
  }).immediate();
  const started = !request.launch || await startLoginWindow(db, user.workspaceId, accountId, request.jobId);
  if (!started) db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'").run("The sign-in window could not start. Try again from Accounts.", request.jobId);
  revalidatePath("/accounts");
  if (!started) return { error: parsed.data.browserMode === "chrome_read_only"
    ? "The account was saved, but the Chrome sign-in check could not start. Try again from the account below."
    : "The account was saved, but its sign-in window could not open. Try again from the account below." };
  const message = request.launch
    ? parsed.data.browserMode === "chrome_read_only"
      ? "Account saved. Outreach is checking the current Chrome sign-in."
      : "Instagram is opening in a separate sign-in window. Sign in there, then refresh this page to see the connection status."
    : queuedLoginMessage(parsed.data.browserMode, worker.phase, smoke);
  return { message };
}
export async function useSignedInChrome(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.hostChromeAllowed) return { error: "Use your company's separate Instagram sign-in window." };
  const parsed = accountIdSchema.safeParse(form.get("id"));
  const account = parsed.success ? getAccount((await getDb(form)), parsed.data) : null;
  if (!account) return { error: "Account not found. Refresh this page." };
  const db = (await getDb(form));
  setAccountBrowserMode(db, account.id, "chrome_read_only", user.email);
  const smoke = process.env.OUTREACH_SMOKE_MODE === "1";
  const worker = workerStatus(db, new Date());
  const backgroundRunning = smoke || workerMayOwnJobs(worker.phase);
  let request: LoginRequest = { jobId: 0, launch: false, alreadyOpening: false };
  db.transaction(() => { request = requestLogin(db, account.id, backgroundRunning); }).immediate();
  const started = !request.launch || await startLoginWindow(db, user.workspaceId, account.id, request.jobId);
  if (!started) db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'").run("The sign-in window could not start. Try again from Accounts.", request.jobId);
  revalidatePath("/accounts");
  if (!started) return { error: "Chrome connection was selected, but the check could not start. Try again." };
  return { message: request.launch
    ? "Chrome selected. Outreach will check that this Instagram account is signed in. Campaign messages still require approval."
    : `${queuedLoginMessage("chrome_read_only", worker.phase, smoke)} Campaign messages still require approval.` };
}
export async function useSeparateSignIn(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(form.get("id"));
  const account = parsed.success ? getAccount((await getDb(form)), parsed.data) : null;
  if (!account) return { error: "Account not found. Refresh this page." };
  if (getAccountDevice((await getDb(form)), account.id)) return { error: "This account uses your connected computer. Manage its connection in Accounts." };
  setAccountBrowserMode((await getDb(form)), account.id, "isolated", user.email);
  revalidatePath("/accounts");
  return { message: "This account will use its separate sign-in window again." };
}
export async function reopenLogin(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(form.get("id"));
  const account = parsed.success ? getAccount((await getDb(form)), parsed.data) : null;
  if (!account) return { error: "Account not found. Refresh this page." };
  const db = (await getDb(form));
  const smoke = process.env.OUTREACH_SMOKE_MODE === "1";
  const worker = workerStatus(db, new Date());
  const backgroundRunning = smoke || workerMayOwnJobs(worker.phase);
  let request: LoginRequest = { jobId: 0, launch: false, alreadyOpening: false };
  db.transaction(() => {
    request = requestLogin(db, account.id, backgroundRunning);
  }).immediate();
  const started = !request.launch || await startLoginWindow(db, user.workspaceId, account.id, request.jobId);
  if (!started) db.prepare("UPDATE jobs SET status='failed',last_error=? WHERE id=? AND status='running'").run("The sign-in window could not start. Try again from Accounts.", request.jobId);
  revalidatePath("/accounts");
  if (!started) return { error: account.browserMode === "chrome_read_only" ? "The Chrome sign-in check could not start. Try again shortly." : "The sign-in window could not open. Try again shortly." };
  if (request.alreadyOpening) return { message: account.browserMode === "chrome_read_only" ? "The Chrome sign-in check is already running. Wait for it to finish before requesting another." : "The sign-in window is already opening. Finish there before requesting another." };
  return { message: request.launch
    ? account.browserMode === "chrome_read_only"
      ? "Chrome sign-in check requested. Switch Chrome to this Instagram account first if a different account is signed in."
      : "Instagram is opening in a separate sign-in window. Sign in there, then refresh this page to see the connection status."
    : smoke
      ? account.browserMode === "chrome_read_only" ? "Chrome sign-in check saved." : "Sign-in window check saved."
    : queuedLoginMessage(account.browserMode, worker.phase, smoke) };
}
export async function changeStatus(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(form.get("id")), status = form.get("status");
  if (!parsed.success || (status !== "active" && status !== "paused")) return { error: "Choose a valid account action." };
  const account = getAccount((await getDb(form)), parsed.data);
  if (!account) return { error: "Account not found. Refresh this page." };
  if (account.status === "blocked") return { error: "Instagram showed a warning. This account stays stopped; resolve it in Instagram and have the warning reviewed before resuming." };
  setAccountStatus((await getDb(form)), parsed.data, status, status === "paused" ? "Paused by team" : "", user.email);
  revalidatePath("/accounts"); return { message: status === "paused" ? "Account paused." : "Account resumed. Working hours and daily limits still apply." };
}
export async function changeCap(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = accountIdSchema.safeParse(form.get("id")), cap = capSchema.safeParse(form.get("cap"));
  if (!id.success || !getAccount((await getDb(form)), id.data)) return { error: "Account not found. Refresh this page." };
  if (!cap.success) return { error: `Choose a whole-number limit from 1 to ${config.absoluteDailyCeiling}.`, field: "cap" };
  setAccountCap((await getDb(form)), id.data, cap.data, user.email);
  revalidatePath("/accounts"); return { message: "Daily limit saved. The gradual ramp-up still applies." };
}
