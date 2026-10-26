import { describe, expect, it } from "vitest";
import { workerMayOwnJobs, type WorkerOwnershipPhase } from "@/lib/domain/worker-ownership";

describe("worker job ownership", () => {
  it.each(["starting", "running", "stopping", "unresponsive", "legacy_running"] as WorkerOwnershipPhase[])(
    "%s may still own an in-flight task",
    (phase) => expect(workerMayOwnJobs(phase)).toBe(true),
  );

  it("allows a separate account process only when the worker is confirmed stopped", () => {
    expect(workerMayOwnJobs("stopped")).toBe(false);
  });
});
