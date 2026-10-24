import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { periodFor } from "@/lib/billing/periods";
import { usageForPeriod } from "@/lib/billing/queries";
import { usageCsv } from "@/lib/billing/csv";
export async function GET(request: Request) {
  const user = await requireUser();
  const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Choose a valid month", { status: 400 });
  const period = periodFor(month + "-01");
  return new Response(usageCsv(usageForPeriod((await getDb()), user.id, period.start, period.end)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="usage-${month}.csv"`, "cache-control": "private, no-store" } });
}
