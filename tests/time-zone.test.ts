import { describe, expect, it } from "vitest";
import { dateInTimeZone, utcRangeForLocalDate } from "@/lib/domain/time-zone";

describe("team-local calendar boundaries", () => {
  it("uses the configured local date rather than the UTC date", () => {
    expect(dateInTimeZone(new Date("2026-10-20T18:45:00Z"), "Asia/Kolkata")).toBe("2026-10-21");
    const range = utcRangeForLocalDate("2026-10-21", "Asia/Kolkata");
    expect(range.start.toISOString()).toBe("2026-10-20T18:30:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-21T18:30:00.000Z");
  });

  it("uses a 23-hour day when daylight saving starts", () => {
    const range = utcRangeForLocalDate("2026-03-08", "America/New_York");
    expect(range.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("uses a 25-hour day when daylight saving ends", () => {
    const range = utcRangeForLocalDate("2026-11-01", "America/New_York");
    expect(range.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("rejects invalid dates and time zones instead of silently miscounting", () => {
    expect(() => utcRangeForLocalDate("2026-02-30", "UTC")).toThrow(RangeError);
    expect(() => utcRangeForLocalDate("2026-02-28", "not-a-time-zone")).toThrow(RangeError);
  });
});
