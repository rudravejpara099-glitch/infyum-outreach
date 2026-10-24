export type AccountConnectionStatus = "active" | "paused" | "blocked";

/** A newer successful inbox read verifies Chrome access when no newer login or inbox failure exists. */
export function inboxReadConfirmsConnection(
  accountStatus: AccountConnectionStatus,
  latestLoginJobId: number | null,
  latestSuccessfulInboxJobId: number | null,
  latestFailedInboxJobId: number | null,
): boolean {
  if (accountStatus === "blocked" || latestSuccessfulInboxJobId === null) return false;
  return latestSuccessfulInboxJobId > (latestLoginJobId ?? 0)
    && latestSuccessfulInboxJobId > (latestFailedInboxJobId ?? 0);
}
