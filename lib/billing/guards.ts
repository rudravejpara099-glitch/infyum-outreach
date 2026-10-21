import type { Db } from "@/lib/db/core";
import { BillingError } from "./errors";
import { profile, integrationReady } from "./config";
import { payerFor } from "./attribution";
import { billingHold } from "./budget";
import { syncBilling } from "./sync";
export function assertCampaignCanStart(db: Db, campaignId: number, actorId: number): void {
  const payer = payerFor(db, "campaign", campaignId);
  const accounts = db.prepare("SELECT account_id FROM campaign_accounts WHERE campaign_id=?").all(campaignId) as { account_id: number }[];
  const assigned = accounts.map(a => payerFor(db, "account", a.account_id));
  if (!payer) {
    if (profile(db, actorId)?.consented_at || assigned.some(Boolean)) throw new BillingError("Assign this campaign and its sending accounts to a payer in Usage and billing first");
    return; // Existing internal, unbilled work remains separate from paid customers.
  }
  if (!integrationReady(db)) throw new BillingError("Paid campaigns are paused until the metered worker integration is reviewed");
  if (!assigned.length || assigned.some(id => id !== payer)) throw new BillingError("Every sending account must have the same payer as this campaign");
  syncBilling(db, payer);
  const hold = billingHold(db, payer); if (hold) throw new BillingError(hold);
}
