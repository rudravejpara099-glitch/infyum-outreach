import type { Db } from "@/lib/db/core";
import { getCampaign } from "@/lib/db/repos/campaigns";
import { isDnc } from "@/lib/db/repos/dnc";
import { addLead } from "@/lib/db/repos/leads";
import { getSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";
import { ApifyOffError, ApifyUsageUncertainError, DEFAULT_SEARCH_ACTOR, MAX_APIFY_RUN_MICROS, toCandidate, type ApifySearchClient, type Candidate } from "@/lib/leads/apify";
import { attachApifyRun, payerFor, reserveUsage, settleUsage } from "@/lib/billing";
import type { Reservation, Source } from "@/lib/billing/types";

/** Search terms come from the niches the campaign picked, plus any extra ones typed in. */
export function termsFor(niches: string[]): string[] {
  const clean = niches.map((n) => n.trim().toLowerCase()).filter((n) => n && n !== "general");
  return [...new Set(clean.length ? clean : ["business coach"])];
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

async function finalRun(client: ApifySearchClient, runId: string) {
  let run = await client.getActorRun(runId);
  if (!TERMINAL.has(run.status) || run.usageTotalUsd === null || !run.finishedAt) throw new ApifyUsageUncertainError("Apify run is still finishing or its charge is not final. The reserved cost remains held.");
  const ageMs = Date.now() - Date.parse(run.finishedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) throw new ApifyUsageUncertainError("Apify run completion time could not be verified. The reserved cost remains held.");
  if (ageMs < 10_000) await new Promise(resolve => setTimeout(resolve, 10_000 - ageMs));
  run = await client.getActorRun(run.id);
  if (!TERMINAL.has(run.status) || run.usageTotalUsd === null) throw new ApifyUsageUncertainError("Apify has not confirmed the final run charge. The reservation remains held.");
  return run;
}

function settleRun(db: Db, reservation: Reservation, run: Awaited<ReturnType<ApifySearchClient["getActorRun"]>>): void {
  if (reservation.status !== "held") return;
  const costMicros = Math.round(run.usageTotalUsd! * 1_000_000);
  if (!Number.isSafeInteger(costMicros)) throw new ApifyUsageUncertainError("Apify run cost is not a safe amount. The reservation remains held.");
  const occurredAt = new Date().toISOString();
  settleUsage(db, reservation.operation_id, [{ eventKey: `${reservation.operation_id}:usage`, userId: reservation.user_id, occurredAt, kind: "apify", quantity: 1, unitCostMicros: costMicros, unitQuantity: 1, costMicros, providerRef: run.id, source: JSON.parse(reservation.source_json) as Source }], occurredAt);
}

async function runTerm(db: Db, client: ApifySearchClient, campaignId: number, payerId: number, jobId: number, actor: string, term: string, termIndex: number, perTerm: number): Promise<unknown[]> {
  const operationId = `apify:${jobId}:${termIndex}`;
  const source: Source = { campaignId, jobId };
  const existing = db.prepare("SELECT * FROM billing_reservations WHERE operation_id=?").get(operationId) as Reservation | undefined;
  let reservation: Reservation;
  let run;

  if (existing) {
    if (existing.provider !== "apify" || existing.user_id !== payerId || existing.source_json !== JSON.stringify(source) || existing.status === "released") throw new ApifyUsageUncertainError("This search reservation needs owner review.");
    if (!existing.provider_run_id) throw new ApifyUsageUncertainError("Apify may have started this run, but returned no run ID. It will not be started again.");
    reservation = existing;
    run = await client.getActorRun(existing.provider_run_id);
  } else {
    const usage = await client.monthlyUsageSnapshot();
    const now = new Date().toISOString();
    const cycleStart = new Date(usage.cycleStartAt);
    const monthStart = new Date(`${now.slice(0, 7)}-01T00:00:00.000Z`);
    if (!Number.isFinite(cycleStart.getTime()) || cycleStart.toISOString() !== monthStart.toISOString()) throw new ApifyOffError("Apify’s monthly usage cycle does not match this app’s calendar-month limit. Lead search is paused to avoid undercounting spend.");
    const hold = reserveUsage(db, {
      userId: payerId, operationId, provider: "apify", maxCostMicros: MAX_APIFY_RUN_MICROS, source,
      now, apifyMonthlyUsageMicros: usage.monthlyUsageMicros, apifyUsageObservedAt: usage.observedAt,
    });
    reservation = hold;
    if (!hold.fresh) {
      if (!hold.provider_run_id) throw new ApifyUsageUncertainError("Apify may have started this run, but returned no run ID. It will not be started again.");
      run = await client.getActorRun(hold.provider_run_id);
    } else {
      run = await client.startActorRun(actor, { search: term, searchType: "user", searchLimit: perTerm, resultsLimit: perTerm }, {
        maxCostMicros: hold.max_cost_micros,
        onRunCreated: (runId) => attachApifyRun(db, operationId, runId),
      });
    }
  }

  run = await finalRun(client, run.id);
  settleRun(db, reservation, run);
  if (run.status !== "SUCCEEDED") throw new Error("Apify finished this run without successful lead results. Its confirmed cost was recorded.");
  return client.getDatasetItems(run.datasetId);
}

export async function findLeadsForCampaign(db: Db, client: ApifySearchClient, campaignId: number, jobId: number, perTerm = 40) {
  const campaign = getCampaign(db, campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== "active") throw new ApifyOffError("Start this campaign before searching for leads.");
  const payerId = payerFor(db, "campaign", campaignId);
  if (!payerId) throw new ApifyOffError("Assign a consenting payer to this campaign before paid lead search.");
  const capRaw = getSetting(db, "apify_monthly_cap_usd");
  if (!capRaw || Number(capRaw) <= 0) throw new ApifyOffError("Lead search is off. Set a monthly limit in Settings.");
  const terms = termsFor(campaign.niches), actor = getSetting(db, "apify_actor") ?? DEFAULT_SEARCH_ACTOR;
  const foundByHandle = new Map<string, Candidate>();

  const heldRuns = db.prepare("SELECT * FROM billing_reservations WHERE provider='apify' AND status='held' AND json_extract(source_json,'$.campaignId')=? ORDER BY created_at").all(campaignId) as Reservation[];
  const recoveredPreviousSearch = heldRuns.some(hold => JSON.parse(hold.source_json).jobId !== jobId);
  for (const hold of heldRuns) {
    if (!hold.provider_run_id) throw new ApifyUsageUncertainError("A previous search may have reached Apify but has no saved run ID. It must be reconciled before searching again.");
    const run = await finalRun(client, hold.provider_run_id);
    settleRun(db, hold, run);
    if (run.status === "SUCCEEDED") {
      const termIndex = Number(hold.operation_id.split(":").at(-1));
      const term = terms[termIndex] ?? "lead search";
      for (const item of await client.getDatasetItems(run.datasetId)) {
        const candidate = toCandidate(item, term);
        if (candidate && !foundByHandle.has(candidate.handle)) foundByHandle.set(candidate.handle, candidate);
      }
    }
  }
  if (recoveredPreviousSearch) {
    const found = [...foundByHandle.values()];
    let added = 0;
    for (const candidate of found) {
      if (isDnc(db, candidate.handle)) continue;
      if (addLead(db, { handle: candidate.handle, followers: candidate.followers, niche: candidate.niche, source: "apify", campaignId }, "apify").created) added++;
    }
    logActivity(db, "apify", "leads.found", { detail: `${added} recovered of ${found.length} results for "${campaign.name}"` });
    return { found: found.length, added };
  }

  for (const [index, term] of terms.entries()) {
    const items = await runTerm(db, client, campaignId, payerId, jobId, actor, term, index, perTerm);
    for (const item of items) {
      const candidate = toCandidate(item, term);
      if (candidate && !foundByHandle.has(candidate.handle)) foundByHandle.set(candidate.handle, candidate);
    }
  }
  const found = [...foundByHandle.values()];
  let added = 0;
  for (const c of found) {
    if (isDnc(db, c.handle)) continue;
    if (addLead(db, { handle: c.handle, followers: c.followers, niche: c.niche, source: "apify", campaignId }, "apify").created) added++;
  }
  logActivity(db, "apify", "leads.found", { detail: `${added} new of ${found.length} found for "${campaign.name}"` });
  return { found: found.length, added };
}
