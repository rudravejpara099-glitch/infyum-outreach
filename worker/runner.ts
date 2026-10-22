import type { Db } from "@/lib/db/core";
import type { AiEngine } from "@/lib/engine/types";
import { AiUsageUncertainError } from "@/lib/engine/anthropic";
import type { InstagramDriver } from "./driver";
import { InstagramBlockedError, InstagramSendUncertainError } from "./driver";
import { commentPrompt, SYSTEM } from "@/lib/engine/prompts";
import { qualify } from "@/lib/domain/qualify";
import { remainingToday } from "@/lib/domain/limits";
import { getAccount, leastLoadedAccount, listAccounts, setAccountStatus } from "@/lib/db/repos/accounts";
import { campaignAccountIds, getCampaign, listCampaigns } from "@/lib/db/repos/campaigns";
import { isDnc } from "@/lib/db/repos/dnc";
import { activeJobExists, claimNext, completeJob, deferJob, deferJobUntil, enqueue, failJob, failJobPermanently, type Lane } from "@/lib/db/repos/jobs";
import { afterJob, DEFAULT_PACING, EMPTY_STATE, gate, type PaceState, type PacingConfig, type Rng } from "@/lib/domain/pacing";
import { assignLead, dueFollowups, findLeadByHandle, getLead, listLeads, moveStage, setNotes, updateFacts } from "@/lib/db/repos/leads";
import { approvedQueue, getMessage, listMessages, markFailed, sentTodayForAccount } from "@/lib/db/repos/messages";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";
import { draftFirstDm, draftFollowup } from "@/lib/services/drafting";
import { afterSent, handleIncoming } from "@/lib/services/outreach";
import { workerControl } from "@/lib/services/worker-lifecycle";
import { findLeadsForCampaign } from "@/lib/services/findLeads";
import { openLoginWindowJob } from "@/lib/services/login-window-job";
import { payerFor } from "@/lib/billing/attribution";
import { browserModeAllowsJob, browserModeAllowsLeadSearch } from "@/lib/domain/browser-mode";
import { canSendAtStage } from "@/lib/domain/stages";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import type { ApifySearchClient } from "@/lib/leads/apify";
import type { Job } from "@/lib/db/types";

export type Deps = {
  db: Db; engine: AiEngine; driver: InstagramDriver;
  now: () => Date;
  /** A human-like pause between sends. Tests pass a no-op. */
  pace: () => Promise<void>;
  /** Human pacing (working hours, sessions, rests, gaps). Switched on by the real worker; tests leave it off. */
  humanPace?: { cfg?: Partial<PacingConfig>; rng?: Rng };
  /** Present only when APIFY_TOKEN is set. */
  apify?: ApifySearchClient;
  /** Checked atomically with job claim when a live local worker owns the lease. */
  mayClaim?: () => boolean;
};

const WARMUP_PIECES = 10;
const INBOX_EVERY_MINUTES = 30;
const teamDate = (db: Db, now: Date) => dateInTimeZone(now, getSetting(db, "team_timezone") ?? DEFAULT_PACING.tz);

/** Looks at the whole database and queues whatever work is due. Safe to run as often as you like. */
export function planWork({ db, now }: Pick<Deps, "db" | "now">): void {
  const active = listCampaigns(db).filter((c) => c.status === "active");
  for (const c of active) {
    const accounts = campaignAccountIds(db, c.id);
    if (accounts.length === 0) continue;
    for (const lead of listLeads(db, { campaignId: c.id, limit: 2000 })) {
      const chosen = lead.accountId ?? leastLoadedAccount(db, accounts)!;
      if (!lead.accountId) assignLead(db, lead.id, c.id, chosen);
      const step = { found: "qualify", qualified: "warmup", warmed: "draft_dm" }[lead.stage as "found" | "qualified" | "warmed"];
      if (!step || activeJobExists(db, step, lead.id)) continue;
      if (step === "draft_dm" && hasOutgoing(db, lead.id, "dm")) continue;
      enqueue(db, { type: step, leadId: lead.id, accountId: chosen });
    }
  }
  for (const lead of dueFollowups(db, now().toISOString().replace("T", " ").slice(0, 19))) {
    const c = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
    if (c?.status !== "active" || !c.followupsEnabled || isDnc(db, lead.handle)) continue;
    if (!activeJobExists(db, "draft_followup", lead.id) && !hasOutgoing(db, lead.id, "followup", ["pending_approval", "approved", "failed"])) {
      enqueue(db, { type: "draft_followup", leadId: lead.id, accountId: lead.accountId });
    }
  }
  for (const m of approvedQueue(db)) {
    const lead = getLead(db, m.leadId);
    if (!lead || !canSendAtStage(lead.stage, m.kind)) continue;
    if (!activeJobExists(db, "send", m.leadId) ) enqueue(db, { type: "send", leadId: m.leadId, accountId: m.accountId, payload: { messageId: m.id } });
  }
  const inboxAccounts = new Set(active.flatMap((c) => campaignAccountIds(db, c.id)));
  // A paused campaign can still receive the reply we were waiting for.
  for (const row of db.prepare("SELECT DISTINCT account_id FROM leads WHERE stage='dm_sent' AND account_id IS NOT NULL").all() as { account_id: number }[]) {
    inboxAccounts.add(row.account_id);
  }
  for (const accountId of inboxAccounts) {
    const key = `inbox_checked_${accountId}`;
    const last = Number(getSetting(db, key) ?? 0);
    if (now().getTime() - last >= INBOX_EVERY_MINUTES * 60_000 && !activeJobExists(db, "check_inbox", null, accountId)) {
      enqueue(db, { type: "check_inbox", accountId });
      setSetting(db, key, String(now().getTime()));
    }
  }
}

function hasOutgoing(db: Db, leadId: number, kind: string, statuses = ["draft", "pending_approval", "approved", "sent", "failed"]): boolean {
  return listMessages(db, { leadId }).some((m) => m.direction === "out" && m.kind === kind && statuses.includes(m.status));
}

/** Runs at most one job (from one lane when given). Returns false when nothing was due. */
export async function runOne(deps: Deps, lane?: Lane): Promise<boolean> {
  const job = claimNext(deps.db, undefined, lane, deps.mayClaim);
  if (!job) return false;
  try {
    await process(deps, job);
    if (deps.humanPace && job.accountId && PACED.has(job.type) && queuedStatus(deps.db, job.id) !== "queued") {
      const rng = deps.humanPace.rng ?? Math.random;
      savePace(deps.db, job.accountId, afterJob(loadPace(deps.db, job.accountId), job.type, deps.now(), rng));
    }
    // A job may defer itself; only mark done if it is still running.
    const row = deps.db.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string };
    if (row.status === "running") completeJob(deps.db, job.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof AiUsageUncertainError) {
      failJobPermanently(deps.db, job.id, msg);
      logActivity(deps.db, "worker", "job.ai_usage_uncertain", { leadId: job.leadId, accountId: job.accountId, detail: `${job.type}: usage requires owner review` });
    } else if (e instanceof InstagramSendUncertainError) {
      const messageId = Number(job.payload.messageId);
      const message = Number.isSafeInteger(messageId) && messageId > 0 ? getMessage(deps.db, messageId) : null;
      if (message?.status === "approved") markFailed(deps.db, messageId, msg);
      if (e.blockedByInstagram && job.accountId) setAccountStatus(deps.db, job.accountId, "blocked", msg, "worker");
      if (message?.status === "sent") completeJob(deps.db, job.id);
      else failJobPermanently(deps.db, job.id, msg);
    } else if (e instanceof InstagramBlockedError && job.accountId) {
      setAccountStatus(deps.db, job.accountId, "blocked", msg || "Instagram showed a warning", "worker");
      completeJob(deps.db, job.id);
    } else {
      failJob(deps.db, job, msg);
      const failed = deps.db.prepare("SELECT status FROM jobs WHERE id=?").get(job.id) as { status: string };
      if (job.type === "send" && failed.status === "failed") {
        const messageId = Number(job.payload.messageId), message = getMessage(deps.db, messageId);
        if (message?.status === "approved") markFailed(deps.db, messageId, "No message was sent. Instagram could not open the conversation after repeated attempts.");
      }
      logActivity(deps.db, "worker", "job.error", { leadId: job.leadId, accountId: job.accountId, detail: `${job.type}: ${msg}` });
    }
  }
  return true;
}

async function process(deps: Deps, job: Job): Promise<void> {
  const { db, driver, engine } = deps;
  const account = job.accountId ? getAccount(db, job.accountId) : null;
  // The signed-in Chrome integration is deliberately read-only. Enforce this
  // before job dispatch as a second boundary in addition to the driver methods.
  if (account && !browserModeAllowsJob(account.browserMode, job.type)) {
    deferJob(db, job, 60);
    return;
  }
  if (job.type === "find_leads") {
    const campaignId = Number(job.payload.campaignId);
    const modes = Number.isSafeInteger(campaignId) && campaignId > 0
      ? campaignAccountIds(db, campaignId).map((id) => getAccount(db, id)?.browserMode).filter((mode): mode is NonNullable<typeof mode> => Boolean(mode))
      : [];
    if (modes.length > 0 && !browserModeAllowsLeadSearch(modes)) {
      deferJob(db, job, 60);
      return;
    }
  }
  if (job.accountId && account?.status !== "active" && job.type !== "open_login") {
    deferJob(db, job, 60); // paused or blocked: wait until the team resumes it
    return;
  }
  const lead = job.leadId ? getLead(db, job.leadId) : null;
  if (lead?.campaignId) {
    const campaign = getCampaign(db, lead.campaignId);
    if (!campaign || campaign.status !== "active") return;
    if (job.accountId && !campaignAccountIds(db, campaign.id).includes(job.accountId)) return;
  } else if (lead && job.type !== "draft_reply") {
    return;
  }

  // Human pace: only jobs that act on Instagram are paced. Drafting with the AI is not.
  if (deps.humanPace && account && PACED.has(job.type)) {
    const cfg = { ...DEFAULT_PACING, tz: getSetting(db, "team_timezone") ?? DEFAULT_PACING.tz, ...deps.humanPace.cfg };
    const g = gate(deps.now(), account.id, loadPace(db, account.id), cfg, deps.humanPace.rng ?? Math.random);
    savePace(db, account.id, g.state);
    if (!g.ok) {
      deferJobUntil(db, job, g.until);
      logActivity(db, "worker", `pace.${g.reason}`, { accountId: account.id, detail: `back at ${g.until.toISOString()}` });
      return;
    }
  }

  switch (job.type) {
    case "find_leads": {
      const campaign = getCampaign(db, Number(job.payload.campaignId));
      if (!campaign || campaign.status !== "active") return;
      if (!deps.apify) throw new Error("APIFY_TOKEN is not set, so lead search cannot run");
      await findLeadsForCampaign(db, deps.apify, Number(job.payload.campaignId), job.id);
      return;
    }

    case "open_login":
      if (account) await openLoginWindowJob(db, job.id, account.id, driver);
      return;

    case "qualify": {
      if (!lead || !account || lead.stage !== "found") return;
      const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
      if (!campaign) return;
      const facts = await driver.readFacts(account, lead.handle);
      updateFacts(db, lead.id, { followers: facts.followers, country: facts.country });
      const verdict = qualify({
        ...facts, alreadyContacted: hasOutgoing(db, lead.id, "dm", ["sent"]), onDoNotContact: isDnc(db, lead.handle),
      }, { minFollowers: campaign.minFollowers, maxFollowers: campaign.maxFollowers, country: campaign.country });
      if (verdict.ok) moveStage(db, lead.id, "qualified", "worker");
      else moveStage(db, lead.id, "skipped", "worker", verdict.reason);
      return;
    }

    case "warmup": {
      if (!lead || !account || lead.stage !== "qualified") return;
      const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
      const campaignPayer = campaign ? payerFor(db, "campaign", campaign.id) : null;
      const accountPayer = payerFor(db, "account", account.id);
      let commentCall = 0;
      const result = await driver.warmUp(account, lead.handle, WARMUP_PIECES, async (context) => {
        commentCall += 1;
        const metering = campaign && campaignPayer && campaignPayer === accountPayer ? {
          db, userId: campaignPayer, operationId: `ai:${job.id}:warmup-comment:${commentCall}`,
          source: { campaignId: campaign.id, accountId: account.id, leadId: lead.id, jobId: job.id }, maxOutputTokens: 160,
        } : undefined;
        const raw = await engine.complete({ system: SYSTEM, prompt: commentPrompt(context), metering });
        return raw.replace(/[—–]/g, ",").replace(/^["']|["']$/g, "").trim();
      });
      logActivity(db, "worker", "lead.warmed_up", { leadId: lead.id, accountId: account.id, detail: `${result.likes} likes, ${result.comments} comments, followed: ${result.followed}` });
      moveStage(db, lead.id, "warmed", "worker");
      return;
    }

    case "draft_dm": {
      if (!lead || lead.stage !== "warmed" || !account) return;
      const notes = await driver.readProfileNotes(account, lead.handle);
      setNotes(db, lead.id, notes.slice(0, 4000));
      await draftFirstDm(db, engine, lead.id, notes, "worker", job.id);
      return;
    }

    case "draft_followup":
      if (lead && lead.stage === "dm_sent") await draftFollowup(db, engine, lead.id, lead.notes, "worker", job.id);
      return;

    case "draft_reply":
      return; // retired: after a first reply a person or the GHL agent takes over. Old queued jobs of this kind are ignored.

    case "send": {
      const message = getMessage(db, Number(job.payload.messageId));
      if (!message || message.status !== "approved" || !lead || !account || message.leadId !== lead.id || message.accountId !== account.id) return;
      if (!canSendAtStage(lead.stage, message.kind)) return;
      const campaign = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
      if (!campaign || campaign.status !== "active" || !campaignAccountIds(db, campaign.id).includes(account.id)) return;
      if (message.kind !== "reply") {
        const today = teamDate(db, deps.now());
        const left = remainingToday(account, today, sentTodayForAccount(db, account.id, today, getSetting(db, "team_timezone") ?? DEFAULT_PACING.tz));
        if (left <= 0) { deferJob(db, job, 120); logActivity(db, "worker", "send.limit_reached", { accountId: account.id }); return; }
      }
      if (isDnc(db, lead.handle)) { markFailed(db, message.id, "Handle is on the do-not-contact list"); return; }
      await deps.pace();
      if (workerControl(db).phase === "stopping") return;
      // Approval, campaign state, or first-reply handoff can change while the worker waits.
      const freshLead = getLead(db, lead.id), freshMessage = getMessage(db, message.id);
      const freshAccount = getAccount(db, account.id);
      const freshCampaign = freshLead?.campaignId ? getCampaign(db, freshLead.campaignId) : null;
      if (!freshLead || !freshMessage || freshMessage.status !== "approved" || !canSendAtStage(freshLead.stage, freshMessage.kind)
        || !freshAccount || freshAccount.status !== "active" || !browserModeAllowsJob(freshAccount.browserMode, "send")
        || !freshCampaign || freshCampaign.status !== "active" || !campaignAccountIds(db, freshCampaign.id).includes(account.id)
        || isDnc(db, freshLead.handle)) return;
      const freshToday = teamDate(db, deps.now());
      if (remainingToday(freshAccount, freshToday, sentTodayForAccount(db, account.id, freshToday, getSetting(db, "team_timezone") ?? DEFAULT_PACING.tz)) <= 0) {
        deferJob(db, job, 120);
        return;
      }
      await driver.sendMessages(account, lead.handle, message.parts);
      try { db.transaction(() => afterSent(db, message.id, deps.now())).immediate(); }
      catch { throw new InstagramSendUncertainError(); }
      return;
    }

    case "check_inbox": {
      if (!account) return;
      for (const incoming of await driver.readInbox(account)) {
        const known = findLeadByHandle(db, incoming.handle);
        if (known) handleIncoming(db, known.id, incoming.text); // strangers who message us are ignored
      }
      return;
    }

    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

/** One full pass: plan, then work through every due job. Used by the loop and by tests. */
export async function runUntilIdle(deps: Deps, maxJobs = 200): Promise<number> {
  planWork(deps);
  let n = 0;
  while (n < maxJobs && (await runOne(deps))) { n++; planWork(deps); }
  return n;
}

const PACED = new Set(["qualify", "warmup", "send", "check_inbox"]);
const queuedStatus = (db: Db, id: number) => (db.prepare("SELECT status FROM jobs WHERE id = ?").get(id) as { status: string }).status;

export function loadPace(db: Db, accountId: number): PaceState {
  const raw = getSetting(db, `pace_${accountId}`);
  return raw ? { ...EMPTY_STATE, ...(JSON.parse(raw) as Partial<PaceState>) } : { ...EMPTY_STATE };
}
function savePace(db: Db, accountId: number, state: PaceState): void {
  setSetting(db, `pace_${accountId}`, JSON.stringify(state));
}

/** The lanes that exist right now: one per Instagram account, plus the shared lane for jobs without an account. */
export function currentLanes(db: Db): Lane[] {
  return [{ accountId: null }, ...listAccounts(db).map((a) => ({ accountId: a.id }))];
}

/**
 * Works through everything due, with every lane running at the same time.
 * Inside one lane jobs run strictly one after another, so an Instagram account is never used twice at once.
 */
export async function runLanesUntilIdle(deps: Deps, maxJobsPerLane = 200): Promise<number> {
  let total = 0;
  // A lane can go quiet while another lane's work queues the next step for it, so repeat until a full pass finds nothing.
  for (;;) {
    planWork(deps);
    const counts = await Promise.all(currentLanes(deps.db).map(async (lane) => {
      let n = 0;
      while (n < maxJobsPerLane && (await runOne(deps, lane))) { n++; planWork(deps); }
      return n;
    }));
    const pass = counts.reduce((a, b) => a + b, 0);
    total += pass;
    if (pass === 0) return total;
  }
}
