import type { IgAccount } from "@/lib/db/types";

/** Explains why the selected sender set cannot run a campaign right now. */
export function campaignSendBlockers(accounts: IgAccount[], selectedIds: number[]): string[] {
  if (selectedIds.length === 0) return [];
  const selected = accounts.filter((account) => selectedIds.includes(account.id));
  if (selected.some((account) => account.status === "active" && account.browserMode === "isolated")) return [];
  const blockers = selected.map((account) => {
    if (account.status === "blocked") return `@${account.handle} is stopped after an Instagram warning`;
    if (account.status === "paused") return `@${account.handle} is paused`;
    if (account.browserMode === "chrome_read_only") return `@${account.handle} uses signed-in Chrome in read-only mode`;
    return `@${account.handle} is not ready`;
  });
  const otherReady = accounts.filter((account) => !selectedIds.includes(account.id) && account.status === "active" && account.browserMode === "isolated");
  if (otherReady.length > 0) blockers.push(`${otherReady.map((account) => `@${account.handle}`).join(", ")} can run campaigns but isn’t selected`);
  else blockers.push("No active account is set up for campaign actions");
  return blockers;
}
