import type { Db } from "@/lib/db/core";
import type { Command } from "./protocol";
import { getAccount } from "@/lib/db/repos/accounts";
import { getLead } from "@/lib/db/repos/leads";
import { getCampaign, campaignAccountIds } from "@/lib/db/repos/campaigns";
import { getMessage, sentTodayForAccount } from "@/lib/db/repos/messages";
import { isDnc } from "@/lib/db/repos/dnc";
import { getSetting } from "@/lib/db/repos/settings";
import { canSendAtStage } from "@/lib/domain/stages";
import { remainingToday } from "@/lib/domain/limits";
import { dateInTimeZone } from "@/lib/domain/time-zone";
import { connectorKindAllowed, connectorWrites } from "@/lib/domain/connector";

/** Recheck the worker's authority when the remote device actually receives a task. */
export function commandMayContinue(db: Db, command: Command, now = new Date()): boolean {
  if (command.expiresAt <= now.getTime() || !["queued", "running"].includes(command.status)) return false;
  const job = db.prepare("SELECT type,lead_id,account_id,payload,attempts FROM jobs WHERE id=? AND status='running'").get(command.jobId) as { type: string; lead_id: number | null; account_id: number; payload: string; attempts: number } | undefined;
  const binding = db.prepare("SELECT device_id FROM account_devices WHERE account_id=?").get(command.accountId) as { device_id: string } | undefined;
  if (!job || job.attempts !== command.jobAttempt || job.account_id !== command.accountId || binding?.device_id !== command.deviceId || !connectorKindAllowed(job.type, command.kind)) return false;
  const account = getAccount(db, command.accountId);
  if (!account) return false;
  if (!connectorWrites(command.kind)) return true;
  const lead = job.lead_id ? getLead(db, job.lead_id) : null;
  const campaign = lead?.campaignId ? getCampaign(db, lead.campaignId) : null;
  if (account.status !== "active" || !lead || !campaign || campaign.status !== "active" || !campaignAccountIds(db, campaign.id).includes(account.id)
    || command.args.handle !== lead.handle || isDnc(db, lead.handle)) return false;
  if (command.kind === "warmUp") return lead.stage === "qualified";
  let messageId: unknown;
  try { messageId = JSON.parse(job.payload).messageId; } catch { return false; }
  const message = typeof messageId === "number" ? getMessage(db, messageId) : null;
  if (!message || message.status !== "approved" || message.accountId !== account.id || message.leadId !== lead.id || !canSendAtStage(lead.stage, message.kind)
    || JSON.stringify(message.parts) !== JSON.stringify(command.args.parts)) return false;
  const zone = getSetting(db, "team_timezone") ?? "America/New_York", today = dateInTimeZone(now, zone);
  return remainingToday(account, today, sentTodayForAccount(db, account.id, today, zone)) > 0;
}
