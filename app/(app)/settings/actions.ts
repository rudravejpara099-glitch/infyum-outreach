"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { addDnc, removeDnc } from "@/lib/db/repos/dnc";
import { findLeadByHandle } from "@/lib/db/repos/leads";
import { markDoNotContact } from "@/lib/services/outreach";
import { setSetting } from "@/lib/db/repos/settings";
import { rescheduleQueuedReadOnlyJobs } from "@/lib/db/repos/jobs";
import { logActivity } from "@/lib/db/repos/activity";
import type { ActionResult } from "@/lib/ui/action-result";
import { handleSchema, validCap, validTimeZone } from "./validation";
import { filtersFromForm } from "@/lib/domain/prospect-filters";
import { writingFromForm } from "@/lib/domain/writing-settings";

function commitAtomically(db: Awaited<ReturnType<typeof getDb>>, write: () => void): boolean {
  try { db.transaction(write).immediate(); return true; }
  catch { return false; }
}

export async function blockHandle(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = handleSchema.safeParse(form.get("handle"));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: "handle" };
  const handle = parsed.data, reason = String(form.get("reason") ?? "").trim();
  if (reason.length > 500) return { error: "Keep the reason under 500 characters.", field: "reason" };
  const db = (await getDb(form));
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
  const db = (await getDb(form));
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
  const db = (await getDb(form));
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
  const db = (await getDb(form));
  let rechecked = 0;
  if (!commitAtomically(db, () => {
    setSetting(db, "team_timezone", zone);
    rechecked = rescheduleQueuedReadOnlyJobs(db);
    logActivity(db, user.email, "settings.team_timezone", { detail: zone });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings"); revalidatePath("/");
  return { message: rechecked ? "Team time zone saved. Queued lead and reply checks will use the updated hours." : "Team time zone saved. The worker uses it for working hours." };
}

export async function saveProspectFilters(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const values: Record<string, string> = {};
  for (const key of ["minFollowers", "maxFollowers", "recentDays", "minRecentPosts", "minEngagementPct", "fitThreshold", "nicheKeywords", "excludeKeywords", "markets"]) values[key] = String(form.get(key) ?? "");
  const parsed = filtersFromForm(values);
  if ("error" in parsed) return { error: parsed.error.message, field: parsed.error.field };
  const db = (await getDb(form));
  if (!commitAtomically(db, () => {
    setSetting(db, "prospect_filters", JSON.stringify(parsed.filters));
    logActivity(db, user.email, "settings.prospect_filters", { detail: `${parsed.filters.minFollowers} to ${parsed.filters.maxFollowers} followers` });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings");
  return { message: "Prospect filters saved. New searches and checks use them." };
}

export async function saveWriting(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const values: Record<string, string> = {};
  for (const key of ["senderName", "company", "location", "offer", "dmPrompt", "commentPrompt"]) values[key] = String(form.get(key) ?? "");
  const parsed = writingFromForm(values);
  if ("error" in parsed) return { error: parsed.error.message, field: parsed.error.field };
  const db = (await getDb(form));
  if (!commitAtomically(db, () => {
    setSetting(db, "writing_settings", JSON.stringify(parsed.writing));
    logActivity(db, user.email, "settings.writing", { detail: `${parsed.writing.senderName} at ${parsed.writing.company}` });
  })) return { error: "Couldn’t save this change. Try again shortly." };
  revalidatePath("/settings");
  return { message: "Sender details and prompts saved. The next messages and comments use them." };
}
