import type { Db } from "@/lib/db/core";
import type { AiEngine } from "@/lib/engine/types";
import type { InstagramDriver } from "./driver";
import { InstagramBlockedError } from "./driver";
import { commentPrompt, SYSTEM } from "@/lib/engine/prompts";
import { qualify } from "@/lib/domain/qualify";
import { remainingToday } from "@/lib/domain/limits";
import { getAccount, setAccountStatus } from "@/lib/db/repos/accounts";
import { campaignAccountIds, getCampaign, listCampaigns } from "@/lib/db/repos/campaigns";
import { isDnc } from "@/lib/db/repos/dnc";
import { activeJobExists, claimNext, completeJob, deferJob, enqueue, failJob } from "@/lib/db/repos/jobs";
import { assignLead, dueFollowups, findLeadByHandle, getLead, listLeads, moveStage, setNotes, updateFacts } from "@/lib/db/repos/leads";
import { approvedQueue, getMessage, listMessages, markFailed, sentTodayForAccount } from "@/lib/db/repos/messages";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";
import { draftFirstDm, draftFollowup, draftReply } from "@/lib/services/drafting";
import { afterSent, handleIncoming } from "@/lib/services/outreach";
import { findLeadsForCampaign } from "@/lib/services/findLeads";
import type { ApifyClient } from "@/lib/leads/apify";
import type { Job } from "@/lib/db/types";

export type Deps = {
  db: Db; engine: AiEngine; driver: InstagramDriver;
  now: () => Date;
  /** A human-like pause between sends. Tests pass a no-op. */
  pace: () => Promise<void>;
  /** Present only when APIFY_TOKEN is set. */
  apify?: Pick<ApifyClient, "monthlyUsageUsd" | "runActor">;
};

const WARMUP_PIECES = 10;
const INBOX_EVERY_MINUTES = 30;
const todayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Looks at the whole database and queues whatever work is due. Safe to run as often as you like. */
export function planWork({ db, now }: Pick<Deps, "db" | "now">): void {
  const active = listCampaigns(db).filter((c) => c.status === "active");
  for (const c of active) {
    const accounts = campaignAccountIds(db, c.id);
    if (accounts.length === 0) continue;
    for (const lead of listLeads(db, { campaignId: c.id, limit: 2000 })) {
      if (!lead.accountId) assignLead(db, lead.id, c.id, accounts[lead.id % accounts.length]);
      const step = { found: "qualify", qualified: "warmup", warmed: "draft_dm" }[lead.stage as "found" | "qualified" | "warmed"];
      if (!step || activeJobExists(db, step, lead.id)) continue;
      if (step === "draft_dm" && hasOutgoing(db, lead.id, "dm")) continue;
      enqueue(db, { type: step, leadId: lead.id, accountId: lead.accountId ?? accounts[lead.id % accounts.length] });
    }
  }
  for (const lead of dueFollowups(db, now().toISOString().replace("T", " ").slice(0, 19))) {
    const c = lead.campaignId ? getCampaign(db, lead.campaignId) : null;
    if (c?.status !== "active" || !c.followupsEnabled || isDnc(db, lead.handle)) continue;
    if (!activeJobExists(db, "draft_followup", lead.id) && !hasOutgoing(db, lead.id, "followup", ["pending_approval", "approved"])) {
      enqueue(db, { type: "draft_followup", leadId: lead.id, accountId: lead.accountId });
    }
  }
  for (const m of approvedQueue(db)) {
    if (!activeJobExists(db, "send", m.leadId) ) enqueue(db, { type: "send", leadId: m.leadId, accountId: m.accountId, payload: { messageId: m.id } });
  }
  for (const c of active) {
    for (const accountId of campaignAccountIds(db, c.id)) {
      const key = `inbox_checked_${accountId}`;
      const last = Number(getSetting(db, key) ?? 0);
      if (now().getTime() - last >= INBOX_EVERY_MINUTES * 60_000 && !activeJobExists(db, "check_inbox", null, accountId)) {
        enqueue(db, { type: "check_inbox", accountId });
        setSetting(db, key, String(now().getTime()));
      }
    }
  }
}

function hasOutgoing(db: Db, leadId: number, kind: string, statuses = ["draft", "pending_approval", "approved", "sent"]): boolean {
  return listMessages(db, { leadId }).some((m) => m.direction === "out" && m.kind === kind && statuses.includes(m.status));
}

/** Runs at most one job. Returns false when nothing was due. */
export async function runOne(deps: Deps): Promise<boolean> {
  const job = claimNext(deps.db);
  if (!job) return false;
  try {
    await process(deps, job);
    // A job may defer itself; only mark done if it is still running.
    const row = deps.db.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string };
    if (row.status === "running") completeJob(deps.db, job.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof InstagramBlockedError && job.accountId) {
      setAccountStatus(deps.db, job.accountId, "blocked", msg || "Instagram showed a warning", "worker");
      completeJob(deps.db, job.id);
    } else {
      failJob(deps.db, job, msg);
      logActivity(deps.db, "worker", "job.error", { leadId: job.leadId, accountId: job.accountId, detail: `${job.type}: ${msg}` });
    }
  }
  return true;
}

async function process(deps: Deps, job: Job): Promise<void> {
  const { db, driver, engine } = deps;
  const account = job.accountId ? getAccount(db, job.accountId) : null;
  if (job.accountId && account?.status !== "active" && job.type !== "open_login") {
    deferJob(db, job, 60); // paused or blocked: wait until the team resumes it
    return;
  }
  const lead = job.leadId ? getLead(db, job.leadId) : null;

  switch (job.type) {
    case "find_leads": {
      if (!deps.apify) throw new Error("APIFY_TOKEN is not set, so lead search cannot run");
      await findLeadsForCampaign(db, deps.apify, Number(job.payload.campaignId));
      return;
    }

    case "open_login":
      if (account) await driver.openLogin(account);
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
      const result = await driver.warmUp(account, lead.handle, WARMUP_PIECES, async (context) => {
        const raw = await engine.complete({ system: SYSTEM, prompt: commentPrompt(context) });
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
      await draftFirstDm(db, engine, lead.id, notes);
      return;
    }

    case "draft_followup":
      if (lead && lead.stage === "dm_sent") await draftFollowup(db, engine, lead.id, lead.notes);
      return;

    case "draft_reply":
      if (lead && !hasOutgoing(db, lead.id, "reply", ["pending_approval", "approved"])) await draftReply(db, engine, lead.id);
      return;

    case "send": {
      const message = getMessage(db, Number(job.payload.messageId));
      if (!message || message.status !== "approved" || !lead || !account) return;
      if (message.kind !== "reply") {
        const left = remainingToday(account, todayOf(deps.now()), sentTodayForAccount(db, account.id, todayOf(deps.now())));
        if (left <= 0) { deferJob(db, job, 120); logActivity(db, "worker", "send.limit_reached", { accountId: account.id }); return; }
      }
      if (isDnc(db, lead.handle)) { markFailed(db, message.id, "Handle is on the do-not-contact list"); return; }
      await deps.pace();
      await driver.sendMessages(account, lead.handle, message.parts);
      afterSent(db, message.id, deps.now());
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
