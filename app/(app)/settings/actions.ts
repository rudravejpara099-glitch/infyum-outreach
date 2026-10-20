"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { createUser, findUserByEmail } from "@/lib/db/repos/users";
import { addDnc, removeDnc } from "@/lib/db/repos/dnc";
import { setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";

export async function addTeammate(form: FormData) {
  const user = await requireUser();
  const parsed = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter a name, a valid email and a password with at least 8 characters.", field: String(parsed.error.issues[0].path[0]) };
  const p = parsed.data;
  if (findUserByEmail(getDb(), p.email)) return { error: "This email already has access to the workspace.", field: "email" };
  createUser(getDb(), p.email, p.name, hashPassword(p.password));
  logActivity(getDb(), user.email, "team.added", { detail: p.email });
  revalidatePath("/settings");
}

export async function blockHandle(form: FormData) {
  const user = await requireUser();
  const handle = String(form.get("handle") ?? "");
  if (!handle.trim()) return;
  addDnc(getDb(), handle, String(form.get("reason") ?? ""));
  logActivity(getDb(), user.email, "dnc.added", { detail: handle });
  revalidatePath("/settings");
}

export async function unblockHandle(form: FormData) {
  const user = await requireUser();
  removeDnc(getDb(), String(form.get("handle")));
  logActivity(getDb(), user.email, "dnc.removed", { detail: String(form.get("handle")) });
  revalidatePath("/settings");
}

/** Leave empty to keep Apify switched off. */
export async function saveApifyCap(form: FormData) {
  const user = await requireUser();
  const raw = String(form.get("cap") ?? "").trim();
  const cap = raw === "" ? "" : String(z.coerce.number().min(0).parse(raw));
  setSetting(getDb(), "apify_monthly_cap_usd", cap);
  logActivity(getDb(), user.email, "settings.apify_cap", { detail: cap || "off" });
  revalidatePath("/settings");
}
