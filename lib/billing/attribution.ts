import { BillingError } from "./errors";
import type { Source } from "./types";
import type { Db } from "@/lib/db/core";
import { profile, integrationReady } from "./config";
export function payerFor(db: Db, kind: "campaign" | "account", resourceId: number): number | null {
  const row = db.prepare("SELECT user_id FROM billing_assignments WHERE resource_kind=? AND resource_id=?").get(kind, resourceId) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}
/** Self-claim only; neither a teammate nor the owner can silently bill somebody else. */
export function claimResource(db: Db, userId: number, kind: "campaign" | "account", resourceId: number, now = new Date().toISOString()): void {
  db.transaction(() => {
    if (!integrationReady(db)) throw new BillingError("Metered worker integration must be reviewed before assigning a payer");
    if (!profile(db, userId)?.consented_at) throw new BillingError("Set your spending limit and accept billing first");
    const table = kind === "campaign" ? "campaigns" : "ig_accounts";
    if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(resourceId)) throw new BillingError("Resource not found");
    const active = kind === "campaign"
      ? db.prepare("SELECT id FROM campaigns WHERE id=? AND status='active'").get(resourceId)
      : db.prepare("SELECT c.id FROM campaigns c JOIN campaign_accounts ca ON ca.campaign_id=c.id WHERE ca.account_id=? AND c.status='active' LIMIT 1").get(resourceId);
    if (active) throw new BillingError("Pause the campaign before assigning its costs");
    const jobs = kind === "campaign"
      ? db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') AND (lead_id IN(SELECT id FROM leads WHERE campaign_id=?) OR json_extract(payload,'$.campaignId')=?) LIMIT 1").get(resourceId, resourceId)
      : db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') AND account_id=? AND type!='open_login' LIMIT 1").get(resourceId);
    if (jobs) throw new BillingError("Finish or cancel pending work before assigning its costs");
    const existing = payerFor(db, kind, resourceId);
    if (existing && existing !== userId) throw new BillingError("This resource already has a different payer");
    if (!existing) db.prepare("INSERT INTO billing_assignments VALUES(?,?,?,?)").run(kind, resourceId, userId, now);
  }).immediate();
}
export function assertAttribution(db: Db, userId: number, source: Source, when = new Date().toISOString()): void {
  if (!source.campaignId && !source.accountId) throw new BillingError("Paid work needs an explicitly assigned campaign or account");
  if (source.campaignId && payerFor(db, "campaign", source.campaignId) !== userId) throw new BillingError("Campaign payer does not match");
  if (source.accountId && payerFor(db, "account", source.accountId) !== userId) throw new BillingError("Instagram account payer does not match");
  for (const [kind, resourceId] of [["campaign", source.campaignId], ["account", source.accountId]] as const) if (resourceId) {
    const row = db.prepare("SELECT assigned_at FROM billing_assignments WHERE resource_kind=? AND resource_id=?").get(kind, resourceId) as { assigned_at: string };
    if (Date.parse(row.assigned_at) > Date.parse(when)) throw new BillingError("Usage cannot predate the payer assignment");
  }
  if (source.leadId) {
    const lead = db.prepare("SELECT campaign_id,account_id FROM leads WHERE id=?").get(source.leadId) as { campaign_id: number | null; account_id: number | null } | undefined;
    if (!lead || (source.campaignId && source.campaignId !== lead.campaign_id) || (lead.campaign_id && payerFor(db, "campaign", lead.campaign_id) !== userId) || (lead.account_id && source.accountId && lead.account_id !== source.accountId)) throw new BillingError("Lead attribution does not match the payer");
  }
  if (source.jobId) {
    const job = db.prepare("SELECT lead_id,account_id FROM jobs WHERE id=?").get(source.jobId) as { lead_id: number | null; account_id: number | null } | undefined;
    if (!job || (job.lead_id && job.lead_id !== source.leadId) || (job.account_id && job.account_id !== source.accountId)) throw new BillingError("Job attribution does not match the operation");
  }
}
