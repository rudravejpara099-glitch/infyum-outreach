"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getIdentityDb, getWorkspaceDb } from "@/lib/workspaces/storage";
import { initializeLegacyOwner, listWorkspaces } from "@/lib/workspaces/catalog";
import { countUsers, findUserByEmail } from "@/lib/db/repos/users";
import { logActivity } from "@/lib/db/repos/activity";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createFirstUser } from "@/lib/auth/first-user";
import { consumeLoginAttempt, clearLoginAttempts } from "@/lib/auth/login-throttle";
import { createSession, destroySession } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/dal";
import { passwordSignInOff } from "@/lib/auth/google-config";

type State = { error?: string } | undefined;
const loginSchema = z.object({ email: z.string().trim().toLowerCase().max(254).email(), password: z.string().min(1).max(256) });
const setupSchema = z.object({ name: z.string().trim().min(1, "Enter your name.").max(100), email: z.string().trim().toLowerCase().max(254).email(), password: z.string().min(8, "Use at least 8 characters.").max(256) });

export async function login(_: State, form: FormData): Promise<State> {
  if (passwordSignInOff()) return { error: "Password sign-in is turned off. Use Continue with Google." };
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  const db = getIdentityDb(), attempt = consumeLoginAttempt(db, parsed.data.email);
  if (!attempt.allowed) return { error: "Too many sign-in attempts. Try again in 15 minutes." };
  const user = findUserByEmail(db, parsed.data.email);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) return { error: "Email or password is wrong." };
  const workspace = listWorkspaces(db, user.id)[0];
  if (!workspace) return { error: "You no longer belong to a workspace. Choose Create a private workspace below and use your existing email and password, or use a new team invitation." };
  clearLoginAttempts(db, parsed.data.email);
  await createSession(user.id, workspace.id);
  logActivity(getWorkspaceDb(workspace.id), user.email, "auth.login");
  redirect("/");
}

/** Public first-run setup is atomic; later users create or join a separate workspace. */
export async function setup(_: State, form: FormData): Promise<State> {
  const db = getIdentityDb();
  if (countUsers(db) > 0) return { error: "Setup is already done. Sign in instead." };
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const passwordHash = hashPassword(parsed.data.password);
  const user = db.transaction(() => {
    const created = createFirstUser(db, { ...parsed.data, passwordHash });
    if (created) initializeLegacyOwner(db, created.id);
    return created;
  }).immediate();
  if (!user) return { error: "Setup is already done. Sign in instead." };
  await createSession(user.id, "legacy");
  logActivity(getWorkspaceDb("legacy"), user.email, "auth.setup");
  redirect("/");
}

export async function logout() {
  await requireUser();
  await destroySession();
  redirect("/login");
}
