import { describe, expect, it } from "vitest";
import { mayRecoverAfterCrash } from "@/lib/domain/job-recovery";

describe("crash recovery", () => {
  it("automatically recovers only idempotent read-only work or retired no-op jobs", () => {
    for (const type of ["qualify", "check_inbox", "draft_reply"]) expect(mayRecoverAfterCrash(type), type).toBe(true);
  });

  it("holds interrupted external writes, paid work, login windows and unknown jobs", () => {
    for (const type of ["warmup", "send", "find_leads", "draft_dm", "draft_followup", "open_login", "unknown"])
      expect(mayRecoverAfterCrash(type), type).toBe(false);
  });
});
