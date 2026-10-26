import type { Db } from "@/lib/db/core";

/** A running campaign must have one selected, active account. */
export function workerStartProblem(db: Db): string | null {
  const campaign = db.prepare(`SELECT c.name, c.approval_required
    FROM campaigns c WHERE c.status='active' AND NOT EXISTS (
      SELECT 1 FROM campaign_accounts ca JOIN ig_accounts a ON a.id=ca.account_id
      WHERE ca.campaign_id=c.id AND a.status='active'
    ) ORDER BY c.id LIMIT 1`).get() as { name: string; approval_required: number } | undefined;
  if (campaign) return `“${campaign.name}” needs a selected, active Instagram account before Outreach can start.`;
  return null;
}
