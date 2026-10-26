import type { Db } from "@/lib/db/core";
import { BillingError } from "./errors";

/** Persist the vendor run ID as soon as Apify returns it, so retries can reconcile rather than launch another run. */
export function attachApifyRun(db: Db, operationId: string, runId: string): void {
  if (!runId || runId.length > 240) throw new BillingError("Apify returned an invalid run ID");
  db.transaction(() => {
    const row = db.prepare("SELECT provider,status,provider_run_id FROM billing_reservations WHERE operation_id=?").get(operationId) as { provider: string; status: string; provider_run_id: string | null } | undefined;
    if (!row || row.provider !== "apify" || row.status !== "held") throw new BillingError("Apify run has no active reservation");
    if (row.provider_run_id && row.provider_run_id !== runId) throw new BillingError("Conflicting Apify run for this reservation");
    db.prepare("UPDATE billing_reservations SET provider_run_id=? WHERE operation_id=? AND status='held'").run(runId, operationId);
  }).immediate();
}
