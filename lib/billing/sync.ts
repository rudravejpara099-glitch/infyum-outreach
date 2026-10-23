import type { Db } from "@/lib/db/core";
import { profile } from "./config";
import { daysBetween, isoDay, closedPeriods } from "./periods";
import { costsForDay, dayCost } from "./resources";
import { recordUsage } from "./ledger";
import { finalizeStatement } from "./statements";
export function syncBilling(db: Db, userId: number, now = new Date().toISOString(), mode?: "local" | "hosted"): void {
  const p = profile(db, userId);
  const consent = p?.consented_at;
  if (!consent) return;
  db.transaction(() => {
    const first = db.prepare("SELECT min(start_date) AS day FROM billing_resource_costs WHERE user_id=?").get(userId) as { day: string | null };
    if (first.day) {
      const start = first.day > isoDay(consent) ? first.day : isoDay(consent);
      for (const day of daysBetween(start, isoDay(now))) for (const cost of costsForDay(db, userId, day, mode)) {
        const amount = dayCost(cost, day);
        if (!amount) continue;
        recordUsage(db, { eventKey: `fixed:${cost.id}:${day}`, userId, occurredAt: day === isoDay(consent) ? consent : day + "T00:00:00.000Z", kind: cost.kind, quantity: 1, unitCostMicros: amount, unitQuantity: 1, costMicros: amount, providerRef: cost.reference, source: cost.account_id ? { accountId: cost.account_id } : {} }, null, now);
      }
    }
    for (const period of closedPeriods(consent, now)) finalizeStatement(db, userId, period, now);
  }).immediate();
}

/** Keep opted-in users' confirmed fixed costs and closed statements current from existing worker infrastructure. */
export function syncConsentedBilling(db: Db, now = new Date().toISOString()): { synced: number; failedUserIds: number[] } {
  const users = db.prepare("SELECT user_id FROM billing_profiles WHERE consented_at IS NOT NULL ORDER BY user_id").all() as { user_id: number }[];
  let synced = 0;
  const failedUserIds: number[] = [];
  for (const { user_id: userId } of users) {
    try { syncBilling(db, userId, now); synced++; }
    catch { failedUserIds.push(userId); }
  }
  return { synced, failedUserIds };
}
