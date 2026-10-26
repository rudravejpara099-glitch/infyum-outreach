"use server";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getIdentityDb, getWorkspacePaths } from "@/lib/workspaces/storage";
import { createPairing, listDevices, revokeDevice } from "@/lib/connectors/catalog";
import { bindAccountDevice, getAccountDevice } from "@/lib/connectors/commands";
import { createAccount } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import type { ActionResult } from "@/lib/ui/action-result";
import { connectSchema } from "../validation";
import { workerStatus } from "@/lib/queries/worker-status";
import { workerMayOwnJobs } from "@/lib/domain/worker-ownership";
import { launchDeviceLogin } from "@/lib/connectors/start-login";
import { DEVICE_PAIRING_TTL_MS } from "@/lib/domain/connector";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import { getSetting } from "@/lib/db/repos/settings";

export async function pairMyDevice(form: FormData): Promise<ActionResult & { code?: string; expiresAt?: number }> {
  const user = await requireUser();
  await getDb(form);
  const now = Date.now();
  return { code: createPairing(getIdentityDb(), user.id, user.workspaceId, now), expiresAt: now + DEVICE_PAIRING_TTL_MS, message: "Connection code ready. It expires in 5 minutes and works once." };
}

export async function disconnectDevice(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await getDb(form);
  try { revokeDevice(getIdentityDb(), user.id, user.workspaceId, String(form.get("deviceId") ?? "")); }
  catch { return { error: "You cannot disconnect this device." }; }
  revalidatePath("/accounts/connect"); revalidatePath("/accounts");
  return { message: "Device disconnected. It can no longer receive campaign tasks." };
}

export async function connectDeviceAccount(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = await getDb(form);
  const parsed = connectSchema.safeParse({ handle: form.get("handle"), dailyCap: form.get("dailyCap"), browserMode: "isolated" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const devices = listDevices(getIdentityDb(), user.workspaceId);
  const device = devices.find(device => device.id === form.get("deviceId"));
  if (!device || !device.lastSeen || Date.now() - device.lastSeen > 30_000) return { error: "Open Outreach Connector on your computer, then refresh this page." };
  const handle = parsed.data.handle.replace(/^@/, "").toLowerCase();
  const paths = getWorkspacePaths(user.workspaceId);
  let accountId = 0, jobId = 0;
  const background = workerMayOwnJobs(workerStatus(db, new Date()).phase);
  try {
    const issue = db.transaction((): string | null => {
      const saved = db.prepare("SELECT id FROM ig_accounts WHERE handle=?").get(handle) as { id: number } | undefined;
      if (saved && db.prepare("SELECT id FROM jobs WHERE account_id=? AND status='running'").get(saved.id)) return "This account is finishing a task. Wait for it to finish before connecting a computer.";
      const boundDevice = saved ? getAccountDevice(db, saved.id) : null;
      if (boundDevice === device.id) return "This Instagram account already uses this computer. Check its connection from Accounts.";
      if (boundDevice && devices.some(current => current.id === boundDevice)) return "This account uses another connected computer. Disconnect that computer below before changing it.";
      const account = saved ?? createAccount(db, { handle, profileDir: path.join(paths.profilesDir, handle), dailyCap: parsed.data.dailyCap, rampStart: dateInTimeZone(new Date(), getSetting(db, "team_timezone") ?? "America/New_York") }, user.email);
      accountId = account.id;
      bindAccountDevice(db, account.id, device.id);
      const queued = db.prepare("SELECT id FROM jobs WHERE account_id=? AND type='open_login' AND status='queued' ORDER BY id LIMIT 1").get(account.id) as { id: number } | undefined;
      jobId = queued?.id ?? enqueue(db, { type: "open_login", accountId: account.id });
      if (!background) db.prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=? AND status='queued'").run(jobId);
      return null;
    }).immediate();
    if (issue) return { error: issue };
  } catch { return { error: "The account connection could not change. Wait for its current task to finish, then try again." }; }
  if (!background && !launchDeviceLogin(db, user.workspaceId, accountId, jobId)) {
    db.prepare("UPDATE jobs SET status='failed',last_error='The sign-in check could not start. Try again from Accounts.' WHERE id=? AND status='running'").run(jobId);
    return { error: "Account saved, but the sign-in check could not start. Try its check button in Accounts." };
  }
  revalidatePath("/accounts");
  return { url: "/accounts", message: "Account saved. Outreach is verifying the sign-in on your connected computer." };
}
