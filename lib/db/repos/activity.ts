import type { Db } from "../core";
import type { ActivityRow } from "../types";

export function logActivity(
  db: Db,
  actor: string,
  action: string,
  extra: { leadId?: number | null; accountId?: number | null; detail?: string } = {},
): void {
  db.prepare("INSERT INTO activity (actor, action, lead_id, account_id, detail) VALUES (?,?,?,?,?)").run(
    actor, action, extra.leadId ?? null, extra.accountId ?? null, extra.detail ?? "",
  );
}

export function listActivity(db: Db, opts: { limit?: number; leadId?: number } = {}): ActivityRow[] {
  const rows = opts.leadId
    ? db.prepare("SELECT * FROM activity WHERE lead_id = ? ORDER BY id DESC LIMIT ?").all(opts.leadId, opts.limit ?? 200)
    : db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(opts.limit ?? 200);
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as number, ts: r.ts as string, actor: r.actor as string, action: r.action as string,
    leadId: r.lead_id as number | null, accountId: r.account_id as number | null, detail: r.detail as string,
  }));
}
