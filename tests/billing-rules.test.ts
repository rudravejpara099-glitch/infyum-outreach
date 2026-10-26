import { describe, expect, it } from "vitest";
import { parseUsd, usd, tokenCostMicros, monthlyShare } from "@/lib/billing/money";
import { statement, processorFeeMicros } from "@/lib/billing/statement";
import { periodFor, closedPeriods, isOverdue } from "@/lib/billing/periods";
import { canReserve, isOwner } from "@/lib/billing/rules";

const event = (costMicros: number, kind = "apify") => ({ kind, costMicros });
describe("integer at-cost billing rules", () => {
  it("parses exact micro-dollars and refuses invalid/unsafe amounts", () => {
    expect(parseUsd("1.000001")).toBe(1000001);
    expect(parseUsd("0")).toBe(0);
    for (const invalid of ["1e3", "-1", "0.0000001", "NaN", "9007199254740991"]) expect(() => parseUsd(invalid)).toThrow();
    expect(usd(1050000)).toBe("$1.05");
    expect(usd(-1, 6)).toBe("-$0.000001");
  });
  it("meters tokens with integer arithmetic and rounds only to a micro-dollar", () => {
    expect(tokenCostMicros(100000, 3000000)).toBe(300000);
    expect(tokenCostMicros(22000, 15000000)).toBe(330000);
    expect(tokenCostMicros(1, 250000)).toBe(0);
    expect(() => tokenCostMicros(-1, 3000000)).toThrow();
  });
  it.each([28, 29, 30, 31])("daily shares sum to the actual monthly expense for %i days", days => {
    const shares = Array.from({ length: days }, (_, i) => monthlyShare(10000000, i + 1, days));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000000);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });
  it("has no markup, payment fee or charge for zero usage", () => {
    expect(statement({ events: [] })).toMatchObject({ subtotalMicros: 0, markupMicros: 0, feeMicros: 0, totalCents: 0, carryMicros: 0 });
  });
  it("passes through costs and grosses up the processor fee without a margin", () => {
    const s = statement({ events: [event(10000000)] });
    expect(s.markupMicros).toBe(0);
    expect(s.totalCents * 10000 - s.feeMicros + s.carryMicros).toBe(10000000);
    expect(s.feeMicros).toBe(processorFeeMicros(s.totalCents, 290, 300000));
    const previous = (s.totalCents - 1) * 10000 - processorFeeMicros(s.totalCents - 1, 290, 300000);
    expect(previous).toBeLessThan(10000000);
  });
  it("preserves signed credits without adding a margin", () => {
    const s = statement({ events: [event(10000000)], adjustmentMicros: -200000, carryMicros: -123 });
    expect(s.markupMicros).toBe(0);
    expect(s.totalCents * 10000 - s.feeMicros + s.carryMicros).toBe(9799877);
    expect(statement({ events: [], carryMicros: -50000 })).toMatchObject({ totalCents: 0, feeMicros: 0, carryMicros: -50000 });
  });
  it("carries small balances rather than charging a minimum or adding a fee", () => {
    const s = statement({ events: [event(1000)] });
    expect(s).toMatchObject({ totalCents: 0, feeMicros: 0, carryMicros: 1000 });
    expect(statement({ events: [event(1000000)], carryMicros: s.carryMicros }).subtotalMicros).toBe(1000000);
  });
  it("never silently accepts invalid fee or money values", () => {
    for (const feeBps of [-1, 10000, 10001]) expect(() => statement({ events: [], feeBps })).toThrow();
    expect(() => statement({ events: [event(-1)] })).toThrow();
    expect(() => statement({ events: [event(Number.MAX_SAFE_INTEGER), event(1)] })).toThrow();
  });
  it("covers costs, credits and fee schedules without adding a margin or losing cents", () => {
    for (const cost of [1, 9999, 500000, 1000000, 10000001, 123456789]) {
      for (const feeBps of [0, 290, 500]) {
        const s = statement({ events: [event(cost)], feeBps, fixedFeeMicros: 300000 });
        expect(s.markupMicros).toBe(0);
        expect(s.totalCents * 10000 - s.feeMicros + s.carryMicros).toBe(cost);
        if (s.totalCents) expect(s.carryMicros).toBeLessThanOrEqual(0);
      }
    }
  });
});
describe("periods, ownership and safety", () => {
  it("uses UTC calendar months and exact seven-day grace", () => {
    expect(periodFor("2026-03-01T00:30:00+05:30")).toEqual({ start: "2026-02-01", end: "2026-03-01", days: 28 });
    expect(closedPeriods("2026-01-31", "2026-03-10T00:00:00Z")).toEqual(["2026-01-01", "2026-02-01"]);
    expect(isOverdue("2026-03-01", "2026-03-07T23:59:59Z")).toBe(false);
    expect(isOverdue("2026-03-01", "2026-03-08T00:00:00Z")).toBe(true);
  });
  it("never guesses the owner", () => {
    expect(isOwner(1, undefined)).toBe(false);
    expect(isOwner(1, "1")).toBe(true);
    expect(isOwner(2, "1")).toBe(false);
    expect(isOwner(1, "1oops")).toBe(false);
  });
  it("requires consent and a ceiling; counts commitments, reservations and fees at 90%", () => {
    expect(canReserve({ consent: false, ceilingMicros: 100000000, projectedMicros: 1 })).toBe(false);
    expect(canReserve({ consent: true, ceilingMicros: 0, projectedMicros: 0 })).toBe(false);
    expect(canReserve({ consent: true, ceilingMicros: 100000000, projectedMicros: 89999999 })).toBe(true);
    expect(canReserve({ consent: true, ceilingMicros: 100000000, projectedMicros: 90000000 })).toBe(false);
  });
});
