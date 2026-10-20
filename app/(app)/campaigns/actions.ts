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

export async function saveCampaign(form: FormData) {
  const user = await requireUser();
  const { input, accountIds } = parseCampaignForm(form);
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
  for (const handle of new Set(handles)) {
    if (!/^[a-zA-Z0-9._]+$/.test(handle) || isDnc(db, handle)) continue;
    addLead(db, { handle, campaignId, source: "pasted" }, user.email);
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function findLeads(form: FormData) {
  await requireUser();
  const campaignId = Number(form.get("id"));
  enqueue(getDb(), { type: "find_leads", payload: { campaignId } });
  revalidatePath(`/campaigns/${campaignId}`);
}
