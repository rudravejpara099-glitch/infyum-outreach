import { describe, expect, it } from "vitest";
import { handleSchema, teammateSchema, supportedTimeZones, validCap, validTimeZone } from "@/app/(app)/settings/validation";
import { accountIdSchema, capSchema, connectSchema } from "@/app/(app)/accounts/validation";

describe("operational form input boundaries", () => {
  it("accepts supported zones including UTC and the Kolkata alias, refuses invalid zones", () => {
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", ...supportedTimeZones()]) expect(validTimeZone(zone)).toBe(true);
    for (const zone of ["", " Mars/Olympus", "Mars/Olympus", "America/New_York "]) expect(validTimeZone(zone)).toBe(false);
  });
  it("accepts an off setting and bounded decimal cap text without NaN, infinity or exponent notation", () => {
    for (const cap of ["", "0", "1.05", "0.000001"]) expect(validCap(cap)).toBe(true);
    for (const cap of ["-1", "NaN", "Infinity", "1e9", "1.0000001", "999999999999999999999"]) expect(validCap(cap)).toBe(false);
  });
  it("normalizes teammate identity while preserving passwords verbatim", () => {
    expect(teammateSchema.parse({ name: "  Maya  ", email: "MAYA@EXAMPLE.TEST ", password: "long password" })).toEqual({ name: "Maya", email: "maya@example.test", password: "long password" });
    expect(teammateSchema.safeParse({ name: "  ", email: "missing", password: "short" }).success).toBe(false);
  });
  it("accepts handles and refuses URLs, path traversal and overlong profile names", () => {
    expect(handleSchema.safeParse(" @maya.coaches ").success).toBe(true);
    for (const handle of ["../escape", "https://instagram.com/maya", "", "a".repeat(31), ".", "..", "@.."]) {
      expect(connectSchema.safeParse({ handle, dailyCap: 35 }).success).toBe(false);
    }
  });
  it("refuses invalid IDs and caps outside the hard ceiling", () => {
    for (const value of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(accountIdSchema.safeParse(value).success).toBe(false);
    for (const value of [0, -1, 61, 35.5, "no"]) expect(capSchema.safeParse(value).success).toBe(false);
    expect(capSchema.parse("35")).toBe(35);
  });
});
