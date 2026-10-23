import { describe, expect, it } from "vitest";
import { inboxReadConfirmsConnection } from "@/lib/domain/account-connection";

describe("inbox connection evidence", () => {
  it("uses a successful inbox read newer than the last sign-in result", () => {
    expect(inboxReadConfirmsConnection("active", 34, 35, null)).toBe(true);
  });

  it("does not let an older inbox read override a newer sign-in check", () => {
    expect(inboxReadConfirmsConnection("active", 36, 35, null)).toBe(false);
  });

  it("does not let a failed inbox read override a successful one", () => {
    expect(inboxReadConfirmsConnection("active", 34, 35, 36)).toBe(false);
  });

  it("never treats an Instagram-blocked account as connected", () => {
    expect(inboxReadConfirmsConnection("blocked", 34, 35, null)).toBe(false);
  });
});
