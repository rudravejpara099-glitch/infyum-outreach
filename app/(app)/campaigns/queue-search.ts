import type { Db } from "@/lib/db/core";
import { enqueue } from "@/lib/db/repos/jobs";

/** The authenticated action validates configuration/campaign before reaching this boundary. */
export function queueLeadSearch(db: Db, campaignId: number): boolean {
  return db.transaction(() => {
    if (db.prepare("SELECT id FROM jobs WHERE type='find_leads' AND status IN ('queued','running') AND json_extract(payload,'$.campaignId')=? LIMIT 1").get(campaignId)) return false;
    enqueue(db, { type: "find_leads", payload: { campaignId } }); return true;
  }).immediate();
}
