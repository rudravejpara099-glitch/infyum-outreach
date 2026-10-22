import type { Db } from "@/lib/db/core";
import { listAccounts } from "@/lib/db/repos/accounts";
import { countByStage } from "@/lib/db/repos/leads";
import { sentTodayForAccount } from "@/lib/db/repos/messages";
import { dailyAllowance } from "@/lib/domain/limits";
import { utcRangeForLocalDate } from "@/lib/domain/time-zone";

export function dashboardData(db: Db, today: string, timeZone = "UTC") {
  const stages = countByStage(db);
  const c = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;
  const day = utcRangeForLocalDate(today, timeZone);
  const week = utcRangeForLocalDate(new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), timeZone);
  const sqlDate = (date: Date) => date.toISOString().replace("T", " ").slice(0, 19);
  const accounts = listAccounts(db).map((a) => ({
    ...a, sentToday: sentTodayForAccount(db, a.id, today, timeZone), allowance: dailyAllowance(a, today),
  }));
  const failedJobTypes = Object.fromEntries((db.prepare("SELECT type, COUNT(*) AS count FROM jobs WHERE status='failed' GROUP BY type")
    .all() as { type: string; count: number }[]).map(({ type, count }) => [type, count]));
  return {
    stages,
    totalLeads: Object.values(stages).reduce((x, y) => x + y, 0),
    sentToday: c("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent' AND sent_at>=? AND sent_at<?", sqlDate(day.start), sqlDate(day.end)),
    sentWeek: c("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent' AND sent_at>=? AND sent_at<?", sqlDate(week.start), sqlDate(day.end)),
    pending: c("SELECT COUNT(*) c FROM messages WHERE status='pending_approval'"),
    failedJobs: c("SELECT COUNT(*) c FROM jobs WHERE status='failed'"),
    failedJobTypes,
    accounts,
  };
}
