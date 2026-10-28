import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";

/** Build plan, Safety rules: one switch that stops everything at once, from the web app or the extension. */
export function killSwitchOn(db: Db): boolean {
  return !!getSetting(db, "kill_switch");
}
export function setKillSwitch(db: Db, on: boolean, by: string): void {
  db.transaction(() => {
    setSetting(db, "kill_switch", on ? new Date().toISOString() : "");
    logActivity(db, by, on ? "kill_switch.on" : "kill_switch.off", {});
  }).immediate();
}
