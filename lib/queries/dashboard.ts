import type { Db } from "@/lib/db/core";
import { listAccounts } from "@/lib/db/repos/accounts";
import { countByStage } from "@/lib/db/repos/leads";
import { sentTodayForAccount } from "@/lib/db/repos/messages";
import { dailyAllowance } from "@/lib/domain/limits";

export function dashboardData(db: Db, today: string) {
  const stages = countByStage(db);
  const c = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;
  const accounts = listAccounts(db).map((a) => ({
    ...a, sentToday: sentTodayForAccount(db, a.id, today), allowance: dailyAllowance(a, today),
  }));
  return {
    stages,
    totalLeads: Object.values(stages).reduce((x, y) => x + y, 0),
    sentToday: c("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent' AND date(sent_at)=?", today),
    sentWeek: c("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent' AND date(sent_at)>=date(?, '-6 days')", today),
    pending: c("SELECT COUNT(*) c FROM messages WHERE status='pending_approval'"),
    failedJobs: c("SELECT COUNT(*) c FROM jobs WHERE status='failed'"),
    accounts,
  };
}
