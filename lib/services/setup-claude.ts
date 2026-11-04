import type { Db } from "@/lib/db/core";
import { claimResource } from "@/lib/billing/attribution";
import { saveCeiling } from "@/lib/billing/config";
import { parseUsd } from "@/lib/billing/money";
import { setCampaignStatus } from "@/lib/db/repos/campaigns";
import { logActivity } from "@/lib/db/repos/activity";
import { setSetting } from "@/lib/db/repos/settings";

export type SetupOptions = { userId: number; limitUsd: string; apifyCapUsd?: string; pauseCampaigns?: boolean; commitSha: string };
export type SetupResult = { ok: true; steps: string[] } | { ok: false; error: string };

/** The one-time steps that switch on paid Claude writing (and metered Apify) for the owner's own campaigns. It never calls Claude
 * or Apify and never spends anything; it only records the owner's monthly limit, the owner's sign-off that the metering was reviewed,
 * and that the owner pays for these campaigns and accounts. Everything happens in one transaction: all of it, or none of it. */
export function setupClaude(db: Db, opts: SetupOptions): SetupResult {
  let limit: number, apifyCap: number | null = null;
  try {
    limit = parseUsd(opts.limitUsd);
    if (limit <= 0) return { ok: false, error: "The monthly limit must be more than $0." };
    if (opts.apifyCapUsd !== undefined) apifyCap = parseUsd(opts.apifyCapUsd);
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Enter dollar amounts like 10 or 2.50." }; }
  if (!db.prepare("SELECT id FROM users WHERE id=?").get(opts.userId)) return { ok: false, error: `There is no user ${opts.userId}. Sign in to the app once to create it.` };
  const campaigns = db.prepare("SELECT id, name, status FROM campaigns").all() as { id: number; name: string; status: string }[];
  const active = campaigns.filter((c) => c.status === "active");
  if (active.length && !opts.pauseCampaigns) return { ok: false, error: `Pause these campaigns first, or run again with --pause-campaigns: ${active.map((c) => c.name).join(", ")}. A payer can only be set on a paused campaign.` };
  if (db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') AND type!='open_login' LIMIT 1").get()) return { ok: false, error: "Some work is still queued or running. Press Stop everything in the app, wait a minute, then run this again." };

  const steps: string[] = [];
  try {
    db.transaction(() => {
      for (const c of active) { setCampaignStatus(db, c.id, "paused", "setup-claude"); steps.push(`Paused campaign "${c.name}" (press Start campaign when you are ready to run)`); }
      saveCeiling(db, opts.userId, limit);
      steps.push(`Monthly limit for paid work set to $${opts.limitUsd}; billing accepted by user ${opts.userId}`);
      db.prepare("INSERT OR IGNORE INTO billing_integration_ack(id, commit_sha, acknowledged_by, verified_at) VALUES(1, ?, ?, ?)").run(opts.commitSha, `user ${opts.userId} via npm run setup:claude`, new Date().toISOString());
      steps.push(`Recorded your sign-off that the metering was reviewed (code version ${opts.commitSha.slice(0, 7)})`);
      for (const c of campaigns) { claimResource(db, opts.userId, "campaign", c.id); steps.push(`You pay for campaign "${c.name}"`); }
      const accounts = db.prepare("SELECT id, handle FROM ig_accounts").all() as { id: number; handle: string }[];
      for (const a of accounts) { claimResource(db, opts.userId, "account", a.id); steps.push(`You pay for account @${a.handle}`); }
      if (apifyCap !== null) { setSetting(db, "apify_monthly_cap_usd", String(Number(opts.apifyCapUsd))); steps.push(`Apify lead search limit set to $${opts.apifyCapUsd} a month`); }
      logActivity(db, `user ${opts.userId}`, "billing.setup_claude", { detail: `limit $${opts.limitUsd}` });
    }).immediate();
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Setup failed; nothing was changed." }; }
  return { ok: true, steps };
}
