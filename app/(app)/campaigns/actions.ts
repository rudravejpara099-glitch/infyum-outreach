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
import { publicBillingError } from "@/lib/billing/errors";
import { assertCampaignCanStart } from "@/lib/billing/guards";
import { queueLeadSearch } from "./queue-search";
import { getSetting } from "@/lib/db/repos/settings";
import { workerStatus } from "@/lib/queries/worker-status";
import { logActivity } from "@/lib/db/repos/activity";
import type { ActionResult } from "@/lib/ui/action-result";
import { MAX_LEAD_FILE_BYTES, normalizeHandle, parseLeadCsv, parsePastedHandles } from "@/lib/ui/lead-input";
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
  const rawId = Number(form.get("id")), parsed = z.enum(["active", "paused", "done"]).safeParse(form.get("status")), db = getDb();
  const campaign = validId(rawId) ? getCampaign(db, rawId) : null;
  if (!campaign || !parsed.success) return { error: "Campaign or status not found. Refresh the page." };
  if (campaign.status === "done") return { error: "This campaign is finished and can’t be restarted." };
  if (parsed.data === "active") {
    if (!campaignAccountIds(db, rawId).length) return { error: "Choose a sending account in campaign settings before starting." };
    try { assertCampaignCanStart(db, rawId, user.id); }
    catch (error) { return { error: publicBillingError(error) }; }
  }
  setCampaignStatus(db, rawId, parsed.data, user.email);
  revalidatePath(`/campaigns/${rawId}`); revalidatePath("/campaigns");
  return { message: parsed.data === "active" && !workerStatus(db, new Date()).running ? "Campaign is active. Tasks will wait until the worker starts." : "Campaign status saved." };
}

/** Permanently remove only an empty draft; campaigns with leads keep their history. */
export async function deleteEmptyDraftCampaign(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id)) return { error: "Campaign not found. Refresh the page." };
  const result = db.transaction(() => {
    const campaign = db.prepare(`SELECT name, status, (SELECT count(*) FROM leads WHERE campaign_id=campaigns.id) AS lead_count
      FROM campaigns WHERE id=?`).get(id) as { name: string; status: string; lead_count: number } | undefined;
    if (!campaign) return { error: "Campaign not found. Refresh the page." };
    if (campaign.status !== "draft") return { error: "Only an empty draft can be deleted. Stop or finish this campaign instead." };
    if (campaign.lead_count !== 0) return { error: "This campaign has leads, so its history is kept. Stop the campaign instead." };
    db.prepare("DELETE FROM campaigns WHERE id=? AND status='draft'").run(id);
    logActivity(db, user.email, "campaign.deleted", { detail: campaign.name });
    return { message: "Empty draft deleted.", url: "/campaigns" };
  }).immediate();
  if (!result.error) {
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    revalidatePath("/activity");
  }
  return result;
}

/** Paste handles. Global duplicates, invalid handles and do-not-contact entries are skipped with counts. */
export async function addLeads(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const campaignId = Number(form.get("id")), db = getDb();
  const campaign = validId(campaignId) ? getCampaign(db, campaignId) : null;
  if (!campaign) return { error: "Campaign not found. Refresh the page." };
  if (campaign.status === "done") return { error: "This campaign is finished. Create a new campaign to add leads." };
  const handles = parsePastedHandles(String(form.get("handles") ?? ""));
  const file = form.get("csv");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LEAD_FILE_BYTES) return { error: "Choose a CSV smaller than 500 KB.", field: "csv" };
    if (!file.name.toLowerCase().endsWith(".csv")) return { error: "Choose a .csv file exported from your spreadsheet.", field: "csv" };
    try { handles.push(...parseLeadCsv(await file.text())); }
    catch (error) { return { error: error instanceof Error ? error.message : "This CSV could not be read.", field: "csv" }; }
  }
  if (!handles.length) return { error: "Paste an Instagram handle or choose a CSV containing leads.", field: "handles" };
  const normalized = handles.map(normalizeHandle);
  const unique = new Set(normalized.filter((handle): handle is string => handle !== null));
  const invalid = normalized.filter(handle => handle === null).length;
  let added = 0;
  let duplicates = normalized.length - invalid - unique.size, blocked = 0;
  const error = db.transaction(() => {
    const current = db.prepare("SELECT status FROM campaigns WHERE id=?").get(campaignId) as { status: string } | undefined;
    if (!current) return "Campaign not found. Refresh the page.";
    if (current.status === "done") return "This campaign is finished. Create a new campaign to add leads.";
    for (const handle of unique) {
      if (isDnc(db, handle)) { blocked++; continue; }
      if (addLead(db, { handle, campaignId, source: file instanceof File && file.size ? "csv" : "pasted" }, user.email).created) added++; else duplicates++;
    }
    return null;
  }).immediate();
  if (error) return { error };
  revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/pipeline");
  return { message: `${added} lead${added === 1 ? "" : "s"} added. ${duplicates} duplicate, ${blocked} do-not-contact and ${invalid} invalid handle${invalid === 1 ? "" : "s"} skipped.` };
}

export async function findLeads(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const campaignId = Number(form.get("id")), db = getDb();
  const campaign = validId(campaignId) ? getCampaign(db, campaignId) : null;
  if (!campaign) return { error: "Campaign not found. Refresh the page." };
  if (campaign.status !== "active") return { error: campaign.status === "done" ? "This campaign is finished. Lead search is off." : "Start this campaign before searching for leads." };
  try { assertCampaignCanStart(db, campaignId, user.id); }
  catch (error) { return { error: publicBillingError(error) }; }
  const cap = Number(getSetting(db, "apify_monthly_cap_usd") ?? "");
  if (!Number.isFinite(cap) || cap <= 0) return { error: "Lead search is off. Save a positive monthly cap in Settings first." };
  if (!process.env.APIFY_TOKEN) return { error: "Lead search is not connected. The owner must configure the Apify connection privately." };
  const queued = queueLeadSearch(db, campaignId);
  revalidatePath(`/campaigns/${campaignId}`);
  return { message: !queued ? "This campaign already has a lead search queued or running." : workerStatus(db, new Date()).running ? "Lead search queued. The worker will check the usage cap before searching." : "Lead search saved. It will wait until the worker starts." };
}
