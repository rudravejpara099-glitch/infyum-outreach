import type { Db } from "@/lib/db/core";
import { profile } from "./config";
export function payerFor(db: Db, kind: "campaign" | "account", resourceId: number): number | null {
  const row = db.prepare("SELECT user_id FROM billing_assignments WHERE resource_kind=? AND resource_id=?").get(kind, resourceId) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}
/** Self-claim only; neither a teammate nor the owner can silently bill somebody else. */
export function claimResource(db: Db, userId: number, kind: "campaign" | "account", resourceId: number, now = new Date().toISOString()): void {
  db.transaction(() => {
    if (!profile(db, userId)?.consented_at) throw new Error("Set your spending limit and accept billing first");
    const table = kind === "campaign" ? "campaigns" : "ig_accounts";
    if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(resourceId)) throw new Error("Resource not found");
    const existing = payerFor(db, kind, resourceId);
    if (existing && existing !== userId) throw new Error("This resource already has a different payer");
    if (!existing) db.prepare("INSERT INTO billing_assignments VALUES(?,?,?,?)").run(kind, resourceId, userId, now);
  }).immediate();
}
export function assertAttribution(db: Db, userId: number, source: { campaignId?: number; accountId?: number }): void {
  if (!source.campaignId && !source.accountId) throw new Error("Paid work needs an explicitly assigned campaign or account");
  if (source.campaignId && payerFor(db, "campaign", source.campaignId) !== userId) throw new Error("Campaign payer does not match");
  if (source.accountId && payerFor(db, "account", source.accountId) !== userId) throw new Error("Instagram account payer does not match");
}
