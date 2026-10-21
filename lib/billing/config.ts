import { BillingError } from "./errors";
import type { Db } from "@/lib/db/core";
import type { BillingConfig, ModelRate, Profile } from "./types";
import { integer } from "./money";
import { isOwner } from "./rules";
export function billingConfig(db: Db, now = new Date().toISOString()): BillingConfig { return (db.prepare("SELECT * FROM billing_config WHERE created_at<=? ORDER BY created_at DESC,id DESC LIMIT 1").get(now) ?? db.prepare("SELECT * FROM billing_config ORDER BY id LIMIT 1").get()) as BillingConfig; }
export function profile(db: Db, userId: number): Profile | null { return db.prepare("SELECT * FROM billing_profiles WHERE user_id=?").get(userId) as Profile | undefined ?? null; }
export function saveCeiling(db: Db, userId: number, amount: number, now = new Date().toISOString()): void {
  integer(amount); if (amount > 1000000000000) throw new BillingError("Monthly ceiling must be at most $1,000,000");
  db.prepare("INSERT INTO billing_profiles(user_id,ceiling_micros,consented_at,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ceiling_micros=excluded.ceiling_micros,consented_at=coalesce(billing_profiles.consented_at,excluded.consented_at)").run(userId, amount, now, now);
}
export function assertOwner(userId: number, configuredId = process.env.BILLING_OWNER_USER_ID): void { if (!isOwner(userId, configuredId)) throw new BillingError("Only the designated owner can do this"); }
export function modelRates(db: Db): ModelRate[] { return db.prepare("SELECT * FROM billing_model_rates WHERE id IN (SELECT max(id) FROM billing_model_rates GROUP BY model) ORDER BY model").all() as ModelRate[]; }
export function verifiedModelRate(db: Db, model: string): ModelRate {
  const rate = db.prepare("SELECT * FROM billing_model_rates WHERE model=? ORDER BY id DESC LIMIT 1").get(model) as ModelRate | undefined;
  if (!rate?.verified) throw new BillingError("Confirm this exact model’s provider prices before paid work");
  return rate;
}
export function integrationReady(db: Db): boolean { return !!db.prepare("SELECT id FROM billing_integration_ack WHERE id=1").get(); }
export function tokenRate(db: Db, model: string, category: "input" | "output" | "cache_read" | "cache_write"): number {
  const rate = verifiedModelRate(db, model);
  const value = rate[`${category}_micros_per_million`];
  if (value === null) throw new BillingError("This token category has no confirmed rate");
  return value;
}
