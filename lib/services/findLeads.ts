import type { Db } from "@/lib/db/core";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { isDnc } from "@/lib/db/repos/dnc";
import { addLead } from "@/lib/db/repos/leads";
import { getSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";
import { searchLeads, type ApifyClient } from "@/lib/leads/apify";

/** Search terms come from the niches the campaign picked, plus any extra ones typed in. */
export function termsFor(niches: string[]): string[] {
  const clean = niches.map((n) => n.trim().toLowerCase()).filter((n) => n && n !== "general");
  return [...new Set(clean.length ? clean : ["business coach"])];
}

export async function findLeadsForCampaign(db: Db, client: Pick<ApifyClient, "monthlyUsageUsd" | "runActor">, campaignId: number, perTerm = 40) {
  const campaign = getCampaign(db, campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const capRaw = getSetting(db, "apify_monthly_cap_usd");
  const found = await searchLeads(client, { capUsd: capRaw ? Number(capRaw) : null, terms: termsFor(campaign.niches), perTerm, actor: getSetting(db, "apify_actor") ?? undefined });
  let added = 0;
  for (const c of found) {
    if (isDnc(db, c.handle)) continue;
    if (addLead(db, { handle: c.handle, followers: c.followers, niche: c.niche, source: "apify", campaignId }, "apify").created) added++;
  }
  logActivity(db, "apify", "leads.found", { detail: `${added} new of ${found.length} found for "${campaign.name}"` });
  return { found: found.length, added };
}
