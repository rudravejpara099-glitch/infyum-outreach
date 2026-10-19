import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listActivity } from "@/lib/db/repos/activity";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET() {
  await requireUser();
  const rows = listActivity(getDb(), { limit: 100000 });
  const csv = ["time,actor,action,lead_id,account_id,detail", ...rows.map((r) => [r.ts, r.actor, r.action, r.leadId, r.accountId, r.detail].map(cell).join(","))].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="activity.csv"' } });
}
