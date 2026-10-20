import { describe, expect, it } from "vitest";
import { accountOffsetMinutes, afterJob, DEFAULT_PACING as cfg, EMPTY_STATE, gate, humanDelayMs, localClock, type DelayKind } from "@/lib/domain/pacing";

const seeded = (seed = 1) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
// 2026-10-20 is in daylight time, New York is UTC-4: 14:00Z = 10:00 local
const at = (utc: string) => new Date(utc);

describe("working hours", () => {
  it("blocks night time and says when to come back", () => {
    const g = gate(at("2026-10-21T03:00:00Z"), 1, EMPTY_STATE, cfg, seeded());   // 23:00 local
    expect(g).toMatchObject({ ok: false, reason: "off_hours" });
    if (!g.ok) {
      const back = localClock(g.until, cfg.tz).minuteOfDay;
      expect(back).toBeGreaterThanOrEqual(9 * 60 - 45); expect(back).toBeLessThanOrEqual(9 * 60 + 45);
    }
  });
  it("allows work in the morning", () => {
    expect(gate(at("2026-10-20T14:00:00Z"), 1, EMPTY_STATE, cfg, seeded()).ok).toBe(true);
  });
  it("gives different accounts different start times, the same one every day", () => {
    const offs = [1, 2, 3, 4, 5].map((id) => accountOffsetMinutes(id, cfg));
    expect(new Set(offs).size).toBeGreaterThan(2);
    expect(accountOffsetMinutes(3, cfg)).toBe(accountOffsetMinutes(3, cfg));
    offs.forEach((o) => expect(Math.abs(o)).toBeLessThanOrEqual(cfg.startJitterMinutes));
  });
});

describe("sessions, rests and lunch", () => {
  it("rests after a work session and resumes after the rest", () => {
    const rng = seeded(7);
    let g = gate(at("2026-10-20T14:00:00Z"), 1, EMPTY_STATE, cfg, rng);
    expect(g.ok).toBe(true);
    const later = at("2026-10-20T15:10:00Z");           // 70 minutes later: session (25 to 50) is over
    const g2 = gate(later, 1, g.state, cfg, rng);
    expect(g2).toMatchObject({ ok: false, reason: "resting" });
    if (!g2.ok) {
      const restMin = (g2.until.getTime() - later.getTime()) / 60000;
      expect(restMin).toBeGreaterThanOrEqual(8); expect(restMin).toBeLessThanOrEqual(25);
      expect(gate(new Date(g2.until.getTime() + 1000), 1, g2.state, cfg, rng).ok).toBe(true);
    }
  });
  it("takes lunch once a day", () => {
    const rng = seeded(3);
    const noon = at("2026-10-20T17:00:00Z");              // 13:00 local
    const g = gate(noon, 2, EMPTY_STATE, cfg, rng);
    expect(g).toMatchObject({ ok: false, reason: "lunch" });
    if (!g.ok) {
      const mins = (g.until.getTime() - noon.getTime()) / 60000;
      expect(mins).toBeGreaterThanOrEqual(30); expect(mins).toBeLessThanOrEqual(55);
      const after = gate(new Date(g.until.getTime() + 1000), 2, g.state, cfg, rng);
      expect(after.ok).toBe(true);                         // no second lunch the same day
    }
  });
  it("leaves a gap after each job so actions are never back to back", () => {
    const now = at("2026-10-20T14:00:00Z");
    const st = afterJob(EMPTY_STATE, "send", now, seeded(5));
    const g = gate(new Date(now.getTime() + 5_000), 1, st, cfg, seeded());
    expect(g).toMatchObject({ ok: false, reason: "gap" });
  });
});

describe("human delays", () => {
  const kinds: DelayKind[] = ["read", "afterLike", "beforeComment", "typeKey", "beforeSend", "betweenParts", "betweenPieces", "betweenChecks", "betweenLeads", "betweenDms"];
  it("stay inside sensible bounds and are not constant", () => {
    for (const k of kinds) {
      const rng = seeded(11); const xs = Array.from({ length: 300 }, () => humanDelayMs(k, rng));
      expect(Math.min(...xs)).toBeGreaterThan(0);
      expect(Math.max(...xs)).toBeLessThan(2_000_000);
      expect(new Set(xs).size).toBeGreaterThan(50);
    }
  });
  it("leave several minutes between DMs and between leads", () => {
    const rng = seeded(2);
    const dm = Array.from({ length: 200 }, () => humanDelayMs("betweenDms", rng));
    expect(Math.min(...dm)).toBeGreaterThanOrEqual(180_000);
    const med = [...dm].sort((a, b) => a - b)[100];
    expect(med).toBeGreaterThan(200_000); expect(med).toBeLessThan(420_000);
  });
  it("usually short, sometimes long", () => {
    const rng = seeded(9); const xs = Array.from({ length: 1000 }, () => humanDelayMs("read", rng));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.max(...xs)).toBeGreaterThan(9_000);     // an occasional long look
    expect(mean).toBeLessThan(6_500);
  });
});
