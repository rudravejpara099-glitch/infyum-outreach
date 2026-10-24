export type WorkerOwnershipPhase = "starting" | "running" | "stopping" | "unresponsive" | "stopped" | "legacy_running";

/** Do not start a second account process while a possibly-live worker may still own jobs. */
export function workerMayOwnJobs(phase: WorkerOwnershipPhase): boolean {
  return phase !== "stopped";
}
