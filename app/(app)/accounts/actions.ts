"use server";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { createAccount, getAccount, setAccountCap, setAccountStatus } from "@/lib/db/repos/accounts";
import { activeJobExists, enqueue } from "@/lib/db/repos/jobs";
import { normHandle } from "@/lib/db/repos/dnc";
import { workerStatus } from "@/lib/queries/worker-status";
import type { ActionResult } from "@/lib/ui/action-result";
import { accountIdSchema, capSchema, connectSchema } from "./validation";

function loginQueued(): string {
  return workerStatus(getDb(), new Date()).running
    ? "Login window requested. Sign in by hand when it opens on this computer."
    : "Login request saved. The worker is not running, so the window will open after it starts on this computer.";
}
export async function connectAccount(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = connectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  const handle = normHandle(parsed.data.handle), db = getDb();
  if (db.prepare("SELECT id FROM ig_accounts WHERE handle=?").get(handle)) return { error: "This account is already saved. Use its Open login window button below.", field: "handle" };
  db.transaction(() => {
    const account = createAccount(db, { handle, profileDir: path.join(config.profilesDir, handle), dailyCap: parsed.data.dailyCap }, user.email);
    enqueue(db, { type: "open_login", accountId: account.id });
  }).immediate();
  revalidatePath("/accounts"); return { message: loginQueued() };
}
export async function reopenLogin(form: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = accountIdSchema.safeParse(form.get("id"));
  if (!parsed.success || !getAccount(getDb(), parsed.data)) return { error: "Account not found. Refresh this page." };
  const db = getDb();
  db.transaction(() => {
    if (!activeJobExists(db, "open_login", null, parsed.data)) enqueue(db, { type: "open_login", accountId: parsed.data });
  }).immediate();
  revalidatePath("/accounts"); return { message: loginQueued() };
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
