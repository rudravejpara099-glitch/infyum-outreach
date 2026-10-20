import type { Db } from "@/lib/db/core";
import { countByStage } from "@/lib/db/repos/leads";

/** Read-only campaign summary. Counts are not capped by the preview length. */
export function campaignOverview(db: Db, campaignId: number) {
  const stages = countByStage(db, campaignId);
  const pendingCount = (db.prepare(`SELECT COUNT(*) AS count FROM messages m
    JOIN leads l ON l.id=m.lead_id WHERE l.campaign_id=? AND m.status='pending_approval'`)
    .get(campaignId) as { count: number }).count;
  const pending = db.prepare(`SELECT m.id, m.lead_id AS leadId, l.handle, m.kind,
    json_array_length(m.parts) AS partCount FROM messages m JOIN leads l ON l.id=m.lead_id
    WHERE l.campaign_id=? AND m.status='pending_approval' ORDER BY m.id LIMIT 2`)
    .all(campaignId) as { id: number; leadId: number; handle: string; kind: string; partCount: number }[];
  return { stages, total: Object.values(stages).reduce((sum, count) => sum + count, 0), pendingCount, pending,
    conversations: stages.replied ?? 0 };
}
