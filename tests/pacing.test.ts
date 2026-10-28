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
  it("starts a fresh session after a prior day's saved session instead of inventing a new rest", () => {
    const state = { ...EMPTY_STATE, sessionEnd: "2026-10-24T14:40:00Z", lunchDay: "2026-10-24", nextActionAt: "2026-10-24T14:45:00Z" };
    const now = at("2026-10-26T14:00:00Z");
    const g = gate(now, 1, state, cfg, seeded(7));
    expect(g.ok).toBe(true);
    const sessionMinutes = (Date.parse(g.state.sessionEnd!) - now.getTime()) / 60_000;
    expect(sessionMinutes).toBeGreaterThanOrEqual(cfg.sessionMinutes[0]);
    expect(sessionMinutes).toBeLessThanOrEqual(cfg.sessionMinutes[1]);
    expect(g.state.restUntil).toBeNull();
    expect(state.sessionEnd).toBe("2026-10-24T14:40:00Z");
  });
  it("keeps an existing current-day rest even when the saved session belongs to an earlier day", () => {
    const restUntil = "2026-10-26T14:10:00Z";
    const state = { ...EMPTY_STATE, sessionEnd: "2026-10-24T14:40:00Z", restUntil };
    const g = gate(at("2026-10-26T14:00:00Z"), 1, state, cfg, seeded(7));
    expect(g).toMatchObject({ ok: false, reason: "resting", until: new Date(restUntil), state: { restUntil } });
  });
  it("uses the configured local midnight even when both timestamps share a UTC date", () => {
    const allDay = { ...cfg, tz: "Asia/Kolkata", dayStartHour: 0, dayEndHour: 24, startJitterMinutes: 0, lunchFromHour: 24 };
    const state = { ...EMPTY_STATE, sessionEnd: "2026-10-20T18:20:00Z" }; // Oct 20, 23:50 local
    const g = gate(at("2026-10-20T18:45:00Z"), 1, state, allDay, seeded(7)); // Oct 21, 00:15 local
    expect(g.ok).toBe(true);
  });
  it("still rests for an expired same-local-day session across a UTC date boundary", () => {
    const allDay = { ...cfg, dayStartHour: 0, dayEndHour: 24, startJitterMinutes: 0, lunchFromHour: 24 };
    const now = at("2026-10-21T01:00:00Z"); // Oct 20, 21:00 local
    const state = { ...EMPTY_STATE, sessionEnd: "2026-10-20T23:50:00Z" }; // Oct 20, 19:50 local
    const g = gate(now, 1, state, allDay, seeded(7));
    expect(g).toMatchObject({ ok: false, reason: "resting" });
    if (!g.ok) {
      const restMinutes = (g.until.getTime() - now.getTime()) / 60_000;
      expect(restMinutes).toBeGreaterThanOrEqual(cfg.restMinutes[0]);
      expect(restMinutes).toBeLessThanOrEqual(cfg.restMinutes[1]);
    }
  });
  it("rests after a work session and resumes after the rest", () => {
    const rng = seeded(7);
    const g = gate(at("2026-10-20T14:00:00Z"), 1, EMPTY_STATE, cfg, rng);
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

describe("build plan timing", () => {
  it("pauses 8 to 12 seconds between posts, with an occasional longer break", () => {
    const calm = () => 0.5;
    const ms = humanDelayMs("betweenPieces", calm);
    expect(ms).toBeGreaterThanOrEqual(8_000);
    expect(ms).toBeLessThanOrEqual(12_000);
    let longest = 0;
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) longest = Math.max(longest, humanDelayMs("betweenPieces", random));
    expect(longest).toBeGreaterThan(12_000);
  });
});
