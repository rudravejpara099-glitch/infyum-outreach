import { BillingError } from "./errors";
import type { Db } from "@/lib/db/core";
import { assertOwner, billingConfig } from "./config";
import { integer } from "./money";
import { periodFor } from "./periods";
export function saveBillingConfig(db: Db, ownerId: number, input: { markupPercent: number; feeBps: number; fixedFeeMicros: number }, now = new Date().toISOString()): void {
  assertOwner(ownerId);
  integer(input.markupPercent); integer(input.feeBps); integer(input.fixedFeeMicros);
  if (input.markupPercent > 100 || input.feeBps >= 10000 || input.fixedFeeMicros % 10000) throw new BillingError("Enter a valid percentage and a fee in whole cents");
  const cfg = billingConfig(db, now);
  db.prepare("INSERT INTO billing_config(markup_percent,fee_bps,fixed_fee_micros,minimum_cents,proxy_seed_micros,hosting_seed_micros,created_at) VALUES(?,?,?,?,?,?,?)").run(input.markupPercent, input.feeBps, input.fixedFeeMicros, cfg.minimum_cents, cfg.proxy_seed_micros, cfg.hosting_seed_micros, periodFor(now).end + "T00:00:00.000Z");
}
export function saveModelRate(db: Db, ownerId: number, input: { model: string; inputMicros: number; outputMicros: number; cacheReadMicros: number | null; cacheWriteMicros: number | null; source: string; confirmed: boolean }, now = new Date().toISOString()): void {
  assertOwner(ownerId);
  if (!input.confirmed || !input.model.trim() || input.model.length > 100 || !/^https:\/\//.test(input.source) || input.source.length > 500) throw new BillingError("Confirm the exact model and add its provider price-page link");
  integer(input.inputMicros); integer(input.outputMicros);
  if (input.cacheReadMicros !== null) integer(input.cacheReadMicros); if (input.cacheWriteMicros !== null) integer(input.cacheWriteMicros);
  db.prepare("INSERT INTO billing_model_rates(model,input_micros_per_million,output_micros_per_million,cache_read_micros_per_million,cache_write_micros_per_million,verified,source,created_at) VALUES(?,?,?,?,?,1,?,?)").run(input.model.trim(), input.inputMicros, input.outputMicros, input.cacheReadMicros, input.cacheWriteMicros, input.source.trim(), now);
}
