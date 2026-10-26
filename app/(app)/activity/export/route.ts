import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listActivity } from "@/lib/db/repos/activity";

import { csvCell } from "@/lib/ui/csv";

export async function GET() {
  await requireUser();
  const rows = listActivity((await getDb()), { limit: 100000 });
  const csv = ["time,actor,action,lead_id,account_id,detail", ...rows.map((r) => [r.ts, r.actor, r.action, r.leadId, r.accountId, r.detail].map(csvCell).join(","))].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "private, no-store", "content-disposition": 'attachment; filename="activity.csv"' } });
}
