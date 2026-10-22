import { describe, expect, it } from "vitest";
import { failedWorkCopy, runningWorkerCopy } from "@/lib/ui/worker-status-copy";

describe("running worker status copy", () => {
  it("explains a scheduled task in the team's time zone", () => {
    expect(runningWorkerCopy(
      { type: "qualify", runAfter: "2026-10-22 13:42:17" },
      new Date("2026-10-22T11:51:00Z"),
      "America/New_York",
    )).toBe("Next lead check at 9:42 AM (team time). Approvals and account limits still apply.");
  });

  it("says tomorrow when the next task crosses the local date", () => {
    expect(runningWorkerCopy(
      { type: "check_inbox", runAfter: "2026-10-23 13:42:17" },
      new Date("2026-10-22T23:00:00Z"),
      "America/New_York",
    )).toBe("Next reply check tomorrow at 9:42 AM (team time). Approvals and account limits still apply.");
  });

  it("does not imply a wait when work is due or no task is queued", () => {
    expect(runningWorkerCopy(
      { type: "qualify", runAfter: "2026-10-22 11:00:00" },
      new Date("2026-10-22T11:51:00Z"),
      "America/New_York",
    )).toContain("working through campaign tasks");
    expect(runningWorkerCopy(null, new Date("2026-10-22T11:51:00Z"), "America/New_York"))
      .toContain("will handle campaign tasks when they are due");
  });

  it("explains old sign-in failures separately from other work that needs attention", () => {
    expect(failedWorkCopy({ open_login: 5 }))
      .toBe("5 sign-in attempts did not finish. Check Accounts if you still need to open a sign-in window.");
    expect(failedWorkCopy({ open_login: 2, qualify: 1 }))
      .toBe("3 background tasks need attention. View activity for details.");
    expect(failedWorkCopy({})).toBeNull();
  });
});
