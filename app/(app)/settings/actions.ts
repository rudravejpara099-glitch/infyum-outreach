"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { createUser, findUserByEmail } from "@/lib/db/repos/users";
import { addDnc, removeDnc } from "@/lib/db/repos/dnc";
import { findLeadByHandle } from "@/lib/db/repos/leads";
import { markDoNotContact } from "@/lib/services/outreach";
import { setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";
import type { ActionResult } from "@/lib/ui/action-result";
import { handleSchema, teammateSchema, validCap, validTimeZone } from "./validation";

export async function addTeammate(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = teammateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  const p = parsed.data, db = getDb();
  if (findUserByEmail(db, p.email)) return { error: "A teammate with that email already exists.", field: "email" };
  createUser(db, p.email, p.name, hashPassword(p.password));
  logActivity(db, user.email, "team.added", { detail: p.email });
  revalidatePath("/settings"); return { message: `${p.name} can now sign in with their email and password.` };
}
export async function blockHandle(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = handleSchema.safeParse(form.get("handle"));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: "handle" };
  const handle = parsed.data, reason = String(form.get("reason") ?? "").trim();
  if (reason.length > 500) return { error: "Keep the reason under 500 characters.", field: "reason" };
  const db = getDb();
  db.transaction(() => {
    const lead = findLeadByHandle(db, handle);
    if (lead) markDoNotContact(db, lead.id, reason, user.email);
    else addDnc(db, handle, reason);
  }).immediate();
  logActivity(getDb(), user.email, "dnc.added", { detail: handle });
  revalidatePath("/settings"); return { message: "Handle added to Do not contact." };
}
export async function unblockHandle(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = handleSchema.safeParse(form.get("handle"));
  if (!parsed.success) return { error: "That handle could not be found." };
  removeDnc(getDb(), parsed.data);
  logActivity(getDb(), user.email, "dnc.removed", { detail: parsed.data });
  revalidatePath("/settings"); return { message: "Handle removed from Do not contact." };
}
export async function saveApifyCap(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const raw = String(form.get("cap") ?? "").trim();
  if (!validCap(raw)) return { error: "Enter a non-negative amount with up to six decimal places, or leave it empty to switch searches off.", field: "cap" };
  const cap = raw === "" ? "" : String(Number(raw));
  setSetting(getDb(), "apify_monthly_cap_usd", cap);
  logActivity(getDb(), user.email, "settings.apify_cap", { detail: cap || "off" });
  revalidatePath("/settings"); return { message: raw === "" || Number(raw) === 0 ? "Lead searches are switched off." : "Monthly lead-search limit saved. No search has been started." };
}
export async function saveTimeZone(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const zone = String(form.get("timeZone") ?? "");
  if (!validTimeZone(zone)) return { error: "Choose a valid time zone from the list.", field: "timeZone" };
  setSetting(getDb(), "team_timezone", zone);
  logActivity(getDb(), user.email, "settings.team_timezone", { detail: zone });
  revalidatePath("/settings"); revalidatePath("/");
  return { message: "Team time zone saved. The worker uses it for working hours." };
}
