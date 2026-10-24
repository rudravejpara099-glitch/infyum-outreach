import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getStatement, breakdown } from "@/lib/billing/statements";
import { isOwner } from "@/lib/billing/rules";
import { usd } from "@/lib/billing/money";
import { csvCell } from "@/lib/billing/csv";
export async function GET(_request: Request, context: RouteContext<"/billing/statements/[id]/export">) {
  const user = await requireUser(); const { id } = await context.params;
  const row = /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? getStatement((await getDb()), Number(id)) : null;
  if (!row || (row.user_id !== user.id && !isOwner(user.id, process.env.BILLING_OWNER_USER_ID))) return new Response("Not found", { status: 404 });
  const data = breakdown(row);
  const items = [...data.items.map(item => [item.label, usd(item.costMicros, 6)]), ["Previous balance / rounding credit", usd(data.previousCarryMicros, 6)], ["Processor fee adjustment", usd(data.adjustmentMicros, 6)], ["Estimated processor fee", usd(data.feeMicros, 6)], ["Frozen total", usd(row.total_cents * 10000, 6)], ["Carry to next statement", usd(row.carry_micros, 6)]];
  return new Response(["item,usd", ...items.map(item => item.map(csvCell).join(","))].join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="statement-${row.id}.csv"`, "cache-control": "private, no-store" } });
}
