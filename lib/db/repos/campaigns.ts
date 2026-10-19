import type { Db } from "../core";
import type { Campaign } from "../types";
import { logActivity } from "./activity";

const map = (r: Record<string, unknown>): Campaign => ({
  id: r.id as number, name: r.name as string, niches: JSON.parse(r.niches as string) as string[],
  audienceText: r.audience_text as string, country: r.country as string,
  minFollowers: r.min_followers as number, maxFollowers: r.max_followers as number,
  bookingLink: r.booking_link as string, approvalRequired: !!r.approval_required,
  followupsEnabled: !!r.followups_enabled, status: r.status as Campaign["status"], createdAt: r.created_at as string,
});

export type CampaignInput = {
  name: string; niches: string[]; audienceText: string; country: string;
  minFollowers: number; maxFollowers: number; bookingLink: string;
  approvalRequired: boolean; followupsEnabled: boolean;
};

export function createCampaign(db: Db, input: CampaignInput, accountIds: number[], actor: string): Campaign {
  const id = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO campaigns (name, niches, audience_text, country, min_followers, max_followers, booking_link, approval_required, followups_enabled)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(input.name, JSON.stringify(input.niches), input.audienceText, input.country, input.minFollowers,
      input.maxFollowers, input.bookingLink, input.approvalRequired ? 1 : 0, input.followupsEnabled ? 1 : 0);
    const cid = Number(info.lastInsertRowid);
    setCampaignAccounts(db, cid, accountIds);
    return cid;
  })();
  logActivity(db, actor, "campaign.created", { detail: input.name });
  return getCampaign(db, id)!;
}

export function updateCampaign(db: Db, id: number, input: CampaignInput, accountIds: number[], actor: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE campaigns SET name=?, niches=?, audience_text=?, country=?, min_followers=?, max_followers=?,
       booking_link=?, approval_required=?, followups_enabled=? WHERE id=?`,
    ).run(input.name, JSON.stringify(input.niches), input.audienceText, input.country, input.minFollowers,
      input.maxFollowers, input.bookingLink, input.approvalRequired ? 1 : 0, input.followupsEnabled ? 1 : 0, id);
    setCampaignAccounts(db, id, accountIds);
  })();
  logActivity(db, actor, "campaign.updated", { detail: input.name });
}

export function setCampaignStatus(db: Db, id: number, status: Campaign["status"], actor: string): void {
  db.prepare("UPDATE campaigns SET status = ? WHERE id = ?").run(status, id);
  logActivity(db, actor, `campaign.${status}`, { detail: String(id) });
}

export function setCampaignAccounts(db: Db, campaignId: number, accountIds: number[]): void {
  db.prepare("DELETE FROM campaign_accounts WHERE campaign_id = ?").run(campaignId);
  const ins = db.prepare("INSERT INTO campaign_accounts (campaign_id, account_id) VALUES (?,?)");
  for (const a of new Set(accountIds)) ins.run(campaignId, a);
}

export function campaignAccountIds(db: Db, campaignId: number): number[] {
  return (db.prepare("SELECT account_id FROM campaign_accounts WHERE campaign_id = ?").all(campaignId) as { account_id: number }[]).map((r) => r.account_id);
}
export function getCampaign(db: Db, id: number): Campaign | null {
  const r = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
export function listCampaigns(db: Db): Campaign[] {
  return (db.prepare("SELECT * FROM campaigns ORDER BY id DESC").all() as Record<string, unknown>[]).map(map);
}
