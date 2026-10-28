import type { Db } from "@/lib/db/core";
import { getSetting } from "@/lib/db/repos/settings";
import { parseSafetySettings, type SafetySettings } from "@/lib/domain/safety-settings";
import { dailyAllowance, type AccountLimits } from "@/lib/domain/limits";
import type { ActionCaps } from "@/lib/domain/safety-settings";

export const safetySettings = (db: Db): SafetySettings => parseSafetySettings(getSetting(db, "safety_settings"));

/** The Settings DM cap and the account's own cap both apply; the lower one wins. */
export function withDmCap<T extends AccountLimits>(db: Db, account: T): T {
  return { ...account, dailyCap: Math.min(account.dailyCap, safetySettings(db).caps.dms) };
}

/** Build plan, Safety rules: the week-one ramp applies to every action, so each cap is held to the ramp until the account has warmed up. */
export function actionLimits(db: Db, account: AccountLimits, todayIso: string): ActionCaps {
  const caps = safetySettings(db).caps;
  const ramp = dailyAllowance({ ...account, dailyCap: Number.MAX_SAFE_INTEGER }, todayIso);
  return { follows: Math.min(caps.follows, ramp), likes: Math.min(caps.likes, ramp), comments: Math.min(caps.comments, ramp), dms: Math.min(caps.dms, ramp) };
}
