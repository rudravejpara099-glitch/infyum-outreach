"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { parseCampaignForm } from "@/lib/campaign-form";
import { campaignAccountIds, createCampaign, getCampaign, setCampaignStatus, updateCampaign } from "@/lib/db/repos/campaigns";
import { getAccount } from "@/lib/db/repos/accounts";
import { addLead } from "@/lib/db/repos/leads";
import { isDnc } from "@/lib/db/repos/dnc";
import { queueLeadSearch } from "./queue-search";
import { getSetting } from "@/lib/db/repos/settings";
import { workerStatus } from "@/lib/queries/worker-status";
import type { ActionResult } from "@/lib/ui/action-result";
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

export async function saveCampaign(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let parsed: ReturnType<typeof parseCampaignForm>;
  try { parsed = parseCampaignForm(form); }
  catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0].message, field: String(error.issues[0].path[0] ?? "") };
    return { error: "Check the campaign details and try again." };
  }
  const { input, accountIds } = parsed, db = getDb(), rawId = String(form.get("id") ?? ""), id = Number(rawId);
  if (rawId && (!validId(id) || !getCampaign(db, id))) return { error: "Campaign not found. Refresh the page." };
  if (accountIds.some(accountId => !getAccount(db, accountId))) return { error: "A selected account is no longer available. Refresh and choose again.", field: "accountIds" };
  if (rawId) {
    updateCampaign(db, id, input, accountIds, user.email);
    revalidatePath(`/campaigns/${id}`); revalidatePath("/campaigns");
    return { message: "Campaign saved.", url: `/campaigns/${id}` };
  }
  const created = createCampaign(db, input, accountIds, user.email);
  revalidatePath("/campaigns"); return { url: `/campaigns/${created.id}` };
}
export async function changeCampaignStatus(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), parsed = z.enum(["active", "paused", "done"]).safeParse(form.get("status")), db = getDb();
  if (!validId(id) || !getCampaign(db, id) || !parsed.success) return { error: "Campaign or status not found. Refresh the page." };
  if (parsed.data === "active" && !campaignAccountIds(db, id).length) return { error: "Choose a sending account in campaign settings before starting." };
  setCampaignStatus(db, id, parsed.data, user.email);
  revalidatePath(`/campaigns/${id}`); revalidatePath("/campaigns");
  return { message: parsed.data === "active" && !workerStatus(db, new Date()).running ? "Campaign is active. Tasks will wait until the worker starts." : "Campaign status saved." };
}
/** Paste handles. Global duplicates, invalid handles and do-not-contact entries are skipped with counts. */
export async function addLeads(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const campaignId = Number(form.get("id")), db = getDb();
  if (!validId(campaignId) || !getCampaign(db, campaignId)) return { error: "Campaign not found. Refresh the page." };
  const handles = String(form.get("handles") ?? "").split(/[\s,]+/).map(handle => handle.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  if (!handles.length) return { error: "Paste at least one Instagram handle.", field: "handles" };
  let added = 0, duplicates = handles.length - new Set(handles).size, blocked = 0, invalid = 0;
  db.transaction(() => {
    for (const handle of new Set(handles)) {
      if (!/^[a-zA-Z0-9._]{1,30}$/.test(handle) || [".", ".."].includes(handle)) { invalid++; continue; }
      if (isDnc(db, handle)) { blocked++; continue; }
      if (addLead(db, { handle, campaignId, source: "pasted" }, user.email).created) added++; else duplicates++;
    }
  }).immediate();
  revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/pipeline");
  return { message: `${added} lead${added === 1 ? "" : "s"} added. ${duplicates} duplicate, ${blocked} do-not-contact and ${invalid} invalid handle${invalid === 1 ? "" : "s"} skipped.` };
}
export async function findLeads(form: FormData): Promise<ActionResult> {
  await requireUser();
  const campaignId = Number(form.get("id")), db = getDb();
  if (!validId(campaignId) || !getCampaign(db, campaignId)) return { error: "Campaign not found. Refresh the page." };
  const cap = Number(getSetting(db, "apify_monthly_cap_usd") ?? "");
  if (!Number.isFinite(cap) || cap <= 0) return { error: "Lead search is off. Save a positive monthly cap in Settings first." };
  if (!process.env.APIFY_TOKEN) return { error: "Lead search is not connected. The owner must configure the Apify connection privately." };
  const queued = queueLeadSearch(db, campaignId);
  revalidatePath(`/campaigns/${campaignId}`);
  return { message: !queued ? "This campaign already has a lead search queued or running." : workerStatus(db, new Date()).running ? "Lead search queued. The worker will check the usage cap before searching." : "Lead search saved. It will wait until the worker starts." };
}
