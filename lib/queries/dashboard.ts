import type { Db } from "@/lib/db/core";
import { listAccounts } from "@/lib/db/repos/accounts";
import { countByStage } from "@/lib/db/repos/leads";
import { sentTodayForAccount } from "@/lib/db/repos/messages";
import { dailyAllowance } from "@/lib/domain/limits";
import { utcRangeForLocalDate } from "@/lib/domain/time-zone";
import type { ActivityRow } from "@/lib/db/types";

function recentOverviewActivity(db: Db, limit = 8): ActivityRow[] {
  const rows = db.prepare(`
    SELECT a.* FROM activity a
    WHERE NOT (
      a.action='job.error'
      AND a.detail LIKE 'check_inbox:%'
      AND a.account_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM activity resolved
        WHERE resolved.action='inbox.checked'
          AND resolved.account_id=a.account_id
          AND resolved.id>a.id
      )
    )
    ORDER BY a.id DESC LIMIT ?
  `).all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number, ts: r.ts as string, actor: r.actor as string, action: r.action as string,
    leadId: r.lead_id as number | null, accountId: r.account_id as number | null, detail: r.detail as string,
  }));
}

export function dashboardData(db: Db, today: string, timeZone = "UTC") {
  const stages = countByStage(db);
  const c = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;
  const day = utcRangeForLocalDate(today, timeZone);
  const week = utcRangeForLocalDate(new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), timeZone);
  const sqlDate = (date: Date) => date.toISOString().replace("T", " ").slice(0, 19);
  const accounts = listAccounts(db).map((a) => ({
    ...a, sentToday: sentTodayForAccount(db, a.id, today, timeZone), allowance: dailyAllowance(a, today),
  }));
  const failedJobTypes = Object.fromEntries((db.prepare(`SELECT failed.type, COUNT(*) AS count FROM jobs failed
    WHERE failed.status='failed'
      AND NOT (
        failed.type='open_login' AND failed.account_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jobs recovered
          WHERE recovered.account_id=failed.account_id AND recovered.id>failed.id
            AND recovered.status='done'
            AND (
              (recovered.type='open_login' AND json_extract(recovered.payload,'$.authenticated')=1)
              OR recovered.type='check_inbox'
            )
        )
      )
    GROUP BY failed.type`)
    .all() as { type: string; count: number }[]).map(({ type, count }) => [type, count]));
  const unresolvedFailedJobs = Object.values(failedJobTypes).reduce((sum, count) => sum + count, 0);
  return {
    stages,
    totalLeads: Object.values(stages).reduce((x, y) => x + y, 0),
    sentToday: c("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent' AND sent_at>=? AND sent_at<?", sqlDate(day.start), sqlDate(day.end)),
    sentWeek: c("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent' AND sent_at>=? AND sent_at<?", sqlDate(week.start), sqlDate(day.end)),
    pending: c("SELECT COUNT(*) c FROM messages WHERE status='pending_approval'"),
    failedJobs: unresolvedFailedJobs,
    failedJobTypes,
    accounts,
    recentActivity: recentOverviewActivity(db),
  };
}
