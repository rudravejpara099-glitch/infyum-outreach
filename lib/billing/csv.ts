import { usd } from "./money";
import { LABELS } from "./statement";
import type { billingOverview } from "./queries";
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function usageCsv(rows: ReturnType<typeof billingOverview>["events"]): string {
  return ["date,kind,quantity,unit_cost_usd,unit_quantity,cost_usd,provider_reference,source", ...rows.map(e => [e.occurred_at, LABELS[e.kind], e.quantity, usd(e.unit_cost_micros, 6).replace("$", ""), e.unit_quantity, usd(e.cost_micros, 6).replace("$", ""), e.provider_ref, e.source_json].map(csvCell).join(","))].join("\r\n");
}
