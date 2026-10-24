"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getIdentityDb, getWorkspaceDb } from "@/lib/workspaces/storage";
import { acceptInvite } from "@/lib/workspaces/catalog";
import { createUser, findUserByEmail } from "@/lib/db/repos/users";
import { logActivity } from "@/lib/db/repos/activity";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/auth/login-throttle";

type State = { error?: string } | undefined;
const schema = z.object({
  name: z.string().trim().max(100), email: z.string().trim().toLowerCase().max(254).email(),
  password: z.string().min(1).max(256), token: z.string().trim().min(16).max(256),
});
const failed = { error: "Unable to join. Check the invitation, email and password, or ask your team owner for a new invitation." };

export async function join(_: State, form: FormData): Promise<State> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return failed;
  const db = getIdentityDb(), input = parsed.data;
  if (!consumeLoginAttempt(db, input.email).allowed) return { error: "Too many attempts. Try again in 15 minutes." };
  const existing = findUserByEmail(db, input.email);
  // Possessing a team invite never proves ownership of an existing login.
  if (existing && !verifyPassword(input.password, existing.passwordHash)) return failed;
  if (!existing && (!input.name || input.password.length < 8)) return { error: "For a new account, enter your name and a password with at least 8 characters." };
  const passwordHash = existing ? undefined : hashPassword(input.password);
  let accepted;
  try {
    accepted = db.transaction(() => {
      const user = existing ?? createUser(db, input.email, input.name, passwordHash!);
      const workspace = acceptInvite(db, user.id, input.token);
      if (!workspace) throw new Error("Invitation unavailable");
      return { user, workspace };
    }).immediate();
  } catch {
    return failed;
  }
  clearLoginAttempts(db, input.email);
  await createSession(accepted.user.id, accepted.workspace.id);
  logActivity(getWorkspaceDb(accepted.workspace.id), accepted.user.email, "auth.join");
  redirect("/");
}
