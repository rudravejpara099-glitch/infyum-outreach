import type { Db } from "@/lib/db/core";
import { getSetting } from "@/lib/db/repos/settings";
import { parseSafetySettings, type SafetySettings } from "@/lib/domain/safety-settings";
import type { AccountLimits } from "@/lib/domain/limits";

export const safetySettings = (db: Db): SafetySettings => parseSafetySettings(getSetting(db, "safety_settings"));

/** The Settings DM cap and the account's own cap both apply; the lower one wins. */
export function withDmCap<T extends AccountLimits>(db: Db, account: T): T {
  return { ...account, dailyCap: Math.min(account.dailyCap, safetySettings(db).caps.dms) };
}
