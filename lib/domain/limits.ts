// How many DMs an account may still send today. Pure: no clock, no database.
export type AccountLimits = {
  status: "active" | "paused" | "blocked";
  dailyCap: number;
  /** ISO date (YYYY-MM-DD) the account started sending. */
  rampStart: string;
};

/** New accounts start slow: 10 a day, then 20, then the full cap. */
const RAMP = [
  { untilDay: 3, perDay: 10 },
  { untilDay: 7, perDay: 20 },
] as const;

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z");
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function dailyAllowance(acct: AccountLimits, todayIso: string): number {
  if (acct.status !== "active") return 0;
  const day = daysBetween(acct.rampStart, todayIso);
  const step = RAMP.find((r) => day < r.untilDay);
  return Math.min(acct.dailyCap, step ? step.perDay : acct.dailyCap);
}

export function remainingToday(acct: AccountLimits, todayIso: string, sentToday: number): number {
  return Math.max(0, dailyAllowance(acct, todayIso) - sentToday);
}
