"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { countUsers, createUser, findUserByEmail } from "@/lib/db/repos/users";
import { logActivity } from "@/lib/db/repos/activity";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

type State = { error?: string } | undefined;

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const setupSchema = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8, "Use at least 8 characters") });

export async function login(_: State, form: FormData): Promise<State> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  const user = findUserByEmail(getDb(), parsed.data.email);
  // Same message for unknown email and wrong password, so nobody can probe which emails exist.
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) return { error: "Email or password is wrong." };
  await createSession(user.id);
  logActivity(getDb(), user.email, "auth.login");
  redirect("/");
}

/** Creates the very first account. Once any user exists, this refuses. */
export async function setup(_: State, form: FormData): Promise<State> {
  const db = getDb();
  if (countUsers(db) > 0) return { error: "Setup is already done. Sign in instead." };
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = createUser(db, parsed.data.email, parsed.data.name, hashPassword(parsed.data.password));
  await createSession(user.id);
  logActivity(db, user.email, "auth.setup");
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
