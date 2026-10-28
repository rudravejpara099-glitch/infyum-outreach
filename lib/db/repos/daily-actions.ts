import type { Db } from "../core";

export type ActionKind = "follow" | "like" | "comment";

export function actionsToday(db: Db, accountId: number, day: string, kind: ActionKind): number {
  const row = db.prepare("SELECT n FROM daily_actions WHERE account_id=? AND day=? AND kind=?").get(accountId, day, kind) as { n: number } | undefined;
  return row?.n ?? 0;
}
export function recordActions(db: Db, accountId: number, day: string, kind: ActionKind, n: number): void {
  if (n <= 0) return;
  db.prepare("INSERT INTO daily_actions (account_id, day, kind, n) VALUES (?,?,?,?) ON CONFLICT(account_id, day, kind) DO UPDATE SET n = n + excluded.n").run(accountId, day, kind, n);
}
