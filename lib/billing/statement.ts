import { BillingError } from "./errors";
import { CENT, integer, roundedRatio, safe, sum } from "./money";
export const LABELS: Record<string, string> = { apify: "Lead search", ai_input_tokens: "AI writing · input", ai_output_tokens: "AI writing · output", proxy_share: "Instagram network", hosting_share: "Hosting" };
export function processorFeeMicros(totalCents: number, bps: number, fixedMicros: number): number {
  integer(totalCents); integer(bps); integer(fixedMicros);
  if (bps >= 10000 || fixedMicros % CENT) throw new BillingError("Invalid processor schedule");
  return sum([roundedRatio(BigInt(totalCents) * BigInt(bps), 10000n) * CENT, fixedMicros]);
}
export function statement(input: {
  events: { kind: string; costMicros: number }[]; carryMicros?: number; adjustmentMicros?: number;
  markupPercent?: number; feeBps?: number; fixedFeeMicros?: number; minimumCents?: number;
}) {
  const { events, markupPercent = 0, feeBps = 290, fixedFeeMicros = 300000, minimumCents = 50 } = input;
  integer(markupPercent); integer(minimumCents);
  if (markupPercent > 100) throw new BillingError("Markup must be from 0 to 100 percent");
  processorFeeMicros(0, feeBps, fixedFeeMicros);
  const subtotalMicros = sum(events.map(e => integer(e.costMicros)));
  const markupMicros = roundedRatio(BigInt(subtotalMicros) * BigInt(markupPercent), 100n);
  const balanceMicros = sum([subtotalMicros, markupMicros, input.carryMicros ?? 0, input.adjustmentMicros ?? 0]);
  let totalCents = 0, feeMicros = 0, carryMicros = balanceMicros;
  if (balanceMicros > 0) {
    const n = BigInt(sum([balanceMicros, fixedFeeMicros])) * 10000n;
    const d = BigInt(10000 - feeBps) * BigInt(CENT);
    let cents = safe((n + d - 1n) / d);
    const net = (amount: number) => sum([integer(amount * CENT), -processorFeeMicros(amount, feeBps, fixedFeeMicros)]);
    while (net(cents) < balanceMicros) cents++;
    while (cents > 0 && net(cents - 1) >= balanceMicros) cents--;
    if (cents >= minimumCents) {
      totalCents = cents; feeMicros = processorFeeMicros(cents, feeBps, fixedFeeMicros);
      carryMicros = sum([balanceMicros, -net(cents)]);
    }
  }
  const totals = new Map<string, number[]>();
  for (const e of events) totals.set(e.kind, [...(totals.get(e.kind) ?? []), e.costMicros]);
  return { items: [...totals].map(([kind, costs]) => ({ kind, label: LABELS[kind] ?? "Usage", costMicros: sum(costs) })),
    subtotalMicros, markupMicros, adjustmentMicros: input.adjustmentMicros ?? 0, previousCarryMicros: input.carryMicros ?? 0,
    balanceMicros, feeMicros, totalCents, carryMicros, markupPercent, feeBps, fixedFeeMicros };
}
export type Statement = ReturnType<typeof statement>;
