import type { IgAccount } from "@/lib/db/types";

/** Explains why the selected sender set cannot run a campaign right now. */
export function campaignSendBlockers(accounts: IgAccount[], selectedIds: number[]): string[] {
  if (selectedIds.length === 0) return [];
  const selected = accounts.filter((account) => selectedIds.includes(account.id));
  if (selected.some((account) => account.status === "active")) return [];
  const blockers = selected.map((account) => {
    if (account.status === "blocked") return `@${account.handle} is stopped after an Instagram warning`;
    if (account.status === "paused") return `@${account.handle} is paused`;
    return `@${account.handle} is not ready`;
  });
  const otherReady = accounts.filter((account) => !selectedIds.includes(account.id) && account.status === "active");
  if (otherReady.length > 0) blockers.push(`${otherReady.map((account) => `@${account.handle}`).join(", ")} can run campaigns but isn’t selected`);
  else blockers.push("No active Instagram account is ready for campaign actions");
  return blockers;
}

export function chromeWarmupNotice(
  accounts: IgAccount[], selectedIds: number[], qualifiedCount: number,
): { accountHandles: string[]; matchedLeadCount: number } | null {
  if (!Number.isSafeInteger(qualifiedCount) || qualifiedCount < 1) return null;
  const activeSenders = accounts.filter((account) => selectedIds.includes(account.id) && account.status === "active");
  if (activeSenders.length === 0 || activeSenders.some((account) => account.browserMode !== "chrome_read_only")) return null;
  return { accountHandles: activeSenders.map((account) => account.handle), matchedLeadCount: qualifiedCount };
}
