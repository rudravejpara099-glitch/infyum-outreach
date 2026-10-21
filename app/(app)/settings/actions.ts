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

function commitAtomically(db: ReturnType<typeof getDb>, write: () => void): boolean {
  try { db.transaction(write).immediate(); return true; }
  catch { return false; }
}

export async function addTeammate(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = teammateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  const p = parsed.data, db = getDb();
  if (findUserByEmail(db, p.email)) return { error: "A teammate with that email already exists.", field: "email" };
  if (!commitAtomically(db, () => {
    createUser(db, p.email, p.name, hashPassword(p.password));
    logActivity(db, user.email, "team.added", { detail: p.email });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings"); return { message: `${p.name} can now sign in with their email and password.` };
}
export async function blockHandle(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = handleSchema.safeParse(form.get("handle"));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: "handle" };
  const handle = parsed.data, reason = String(form.get("reason") ?? "").trim();
  if (reason.length > 500) return { error: "Keep the reason under 500 characters.", field: "reason" };
  const db = getDb();
  if (!commitAtomically(db, () => {
    const lead = findLeadByHandle(db, handle);
    if (lead) markDoNotContact(db, lead.id, reason, user.email);
    else addDnc(db, handle, reason);
    logActivity(db, user.email, "dnc.added", { detail: handle });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings"); return { message: "Handle added to Do not contact." };
}
export async function unblockHandle(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = handleSchema.safeParse(form.get("handle"));
  if (!parsed.success) return { error: "That handle could not be found." };
  const db = getDb();
  if (!commitAtomically(db, () => {
    removeDnc(db, parsed.data);
    logActivity(db, user.email, "dnc.removed", { detail: parsed.data });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings"); return { message: "Handle removed from Do not contact." };
}
export async function saveApifyCap(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const raw = String(form.get("cap") ?? "").trim();
  if (!validCap(raw)) return { error: "Enter a non-negative amount with up to six decimal places, or leave it empty to switch searches off.", field: "cap" };
  const cap = raw === "" ? "" : String(Number(raw));
  const db = getDb();
  if (!commitAtomically(db, () => {
    setSetting(db, "apify_monthly_cap_usd", cap);
    logActivity(db, user.email, "settings.apify_cap", { detail: cap || "off" });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings"); return { message: raw === "" || Number(raw) === 0 ? "Lead searches are switched off." : "Monthly lead-search limit saved. No search has been started." };
}
export async function saveTimeZone(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const zone = String(form.get("timeZone") ?? "");
  if (!validTimeZone(zone)) return { error: "Choose a valid time zone from the list.", field: "timeZone" };
  const db = getDb();
  if (!commitAtomically(db, () => {
    setSetting(db, "team_timezone", zone);
    logActivity(db, user.email, "settings.team_timezone", { detail: zone });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings"); revalidatePath("/");
  return { message: "Team time zone saved. The worker uses it for working hours." };
}
