"use server";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { createAccount, getAccount, listAccounts, setAccountCap, setAccountStatus } from "@/lib/db/repos/accounts";
import { enqueue } from "@/lib/db/repos/jobs";
import { normHandle } from "@/lib/db/repos/dnc";

const connectSchema = z.object({
  handle: z.string().min(1).regex(/^@?[a-zA-Z0-9._]+$/, "Handle can only have letters, numbers, dots and underscores"),
  dailyCap: z.coerce.number().int().min(1).max(config.absoluteDailyCeiling),
});

export async function connectAccount(form: FormData) {
  const user = await requireUser();
  const result = connectSchema.safeParse(Object.fromEntries(form));
  if (!result.success) return { error: `Enter a valid Instagram handle and a whole-number daily limit between 1 and ${config.absoluteDailyCeiling}.`, field: result.error.issues[0].path[0] as string };
  const parsed = result.data;
  if (listAccounts(getDb()).some(account => account.handle === normHandle(parsed.handle))) return { error: "This account is already added. Choose Sign in to Instagram below.", field: "handle" };
  const handle = normHandle(parsed.handle);
  const acct = createAccount(getDb(), { handle, profileDir: path.join(config.profilesDir, handle), dailyCap: parsed.dailyCap }, user.email);
  enqueue(getDb(), { type: "open_login", accountId: acct.id });
  revalidatePath("/accounts");
  return { message: "Account added. Sign in when the Instagram window opens. If it doesn’t open, see the help below." };
}

export async function reopenLogin(form: FormData) {
  await requireUser();
  enqueue(getDb(), { type: "open_login", accountId: Number(form.get("id")) });
  revalidatePath("/accounts");
  return { message: "Sign-in window requested. See the help above if it doesn’t open." };
}

export async function changeStatus(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const status = z.enum(["active", "paused"]).parse(form.get("status"));
  if (!getAccount(getDb(), id)) return;
  setAccountStatus(getDb(), id, status, status === "paused" ? "Paused by team" : "", user.email);
  revalidatePath("/accounts");
}

export async function changeCap(form: FormData) {
  const user = await requireUser();
  const cap = z.coerce.number().int().min(1).max(config.absoluteDailyCeiling).parse(form.get("cap"));
  setAccountCap(getDb(), Number(form.get("id")), cap, user.email);
  revalidatePath("/accounts");
}
