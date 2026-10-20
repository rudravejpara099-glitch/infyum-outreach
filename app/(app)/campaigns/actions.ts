"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { parseCampaignForm } from "@/lib/campaign-form";
import { createCampaign, getCampaign, setCampaignStatus, updateCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { isDnc } from "@/lib/db/repos/dnc";
import { enqueue } from "@/lib/db/repos/jobs";

export async function saveCampaign(_: { error?: string; field?: string } | undefined, form: FormData) {
  const user = await requireUser();
  let parsed: ReturnType<typeof parseCampaignForm>;
  try { parsed = parseCampaignForm(form); } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const issue = error.issues[0];
    const field = String(issue.path[0] ?? "");
    const hints: Record<string, string> = { audienceText: "Keep the audience description under 2,000 characters.", country: "Enter the country you want to reach.", minFollowers: "Enter a whole number from 0 up to the maximum follower count.", maxFollowers: "Enter a whole number greater than 0 and at least the minimum follower count." };
    return { error: hints[field] ?? issue.message, field };
  }
  const { input, accountIds } = parsed;
  const id = Number(form.get("id") || 0);
  if (id) {
    if (!getCampaign(getDb(), id)) throw new Error("Campaign not found");
    updateCampaign(getDb(), id, input, accountIds, user.email);
    revalidatePath(`/campaigns/${id}`);
    redirect(`/campaigns/${id}`);
  }
  const created = createCampaign(getDb(), input, accountIds, user.email);
  redirect(`/campaigns/${created.id}`);
}

export async function changeCampaignStatus(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const status = z.enum(["active", "paused", "done"]).parse(form.get("status"));
  setCampaignStatus(getDb(), id, status, user.email);
  revalidatePath(`/campaigns/${id}`);
}

/** Paste handles (one per line or comma separated). Duplicates and do-not-contact handles are skipped. */
export async function addLeads(form: FormData) {
  const user = await requireUser();
  const campaignId = Number(form.get("id"));
  const handles = String(form.get("handles") ?? "").split(/[\s,]+/).map((h) => h.trim().replace(/^@/, "")).filter(Boolean);
  const db = getDb();
  let added = 0;
  let skipped = 0;
  for (const handle of new Set(handles)) {
    if (!/^[a-zA-Z0-9._]+$/.test(handle) || isDnc(db, handle)) { skipped++; continue; }
    const result = addLead(db, { handle, campaignId, source: "pasted" }, user.email);
    if (result.created) added++; else skipped++;
  }
  revalidatePath(`/campaigns/${campaignId}`);
  return { message: `${added} lead${added === 1 ? "" : "s"} added.${skipped ? ` ${skipped} skipped because the handle is invalid, already exists, or is on the do not contact list.` : ""}` };
}

export async function findLeads(form: FormData) {
  await requireUser();
  const campaignId = Number(form.get("id"));
  enqueue(getDb(), { type: "find_leads", payload: { campaignId } });
  revalidatePath(`/campaigns/${campaignId}`);
  return { message: "Search requested. New leads appear here once the search has finished. If it doesn’t begin, check Connection help in Settings." };
}
