"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getIdentityDb, getWorkspaceDb } from "@/lib/workspaces/storage";
import { createWorkspace } from "@/lib/workspaces/catalog";
import { createUser, findUserByEmail } from "@/lib/db/repos/users";
import { logActivity } from "@/lib/db/repos/activity";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/auth/login-throttle";

type State = { error?: string } | undefined;
const schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  workspaceName: z.string().trim().min(1, "Enter your company or team name.").max(100),
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters.").max(256),
});

export async function register(_: State, form: FormData): Promise<State> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = getIdentityDb();
  if (!consumeLoginAttempt(db, parsed.data.email).allowed) return { error: "Too many attempts. Try again in 15 minutes." };
  const existing = findUserByEmail(db, parsed.data.email);
  if (existing && !verifyPassword(parsed.data.password, existing.passwordHash)) return { error: "Unable to create this account. If you already have an account, use its existing password." };
  const passwordHash = existing ? undefined : hashPassword(parsed.data.password);
  let created;
  try {
    created = db.transaction(() => {
      const user = existing ?? createUser(db, parsed.data.email, parsed.data.name, passwordHash!);
      return { user, workspace: createWorkspace(db, user.id, parsed.data.workspaceName) };
    }).immediate();
  } catch {
    return { error: "Unable to create this account. Try again or sign in if you already have an account." };
  }
  clearLoginAttempts(db, parsed.data.email);
  await createSession(created.user.id, created.workspace.id);
  logActivity(getWorkspaceDb(created.workspace.id), created.user.email, "auth.register");
  redirect("/");
}
