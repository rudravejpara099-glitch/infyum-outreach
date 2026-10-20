// Human pace. Pure functions: time and randomness are passed in, so every rule is testable.
// Volumes (35 DMs a day, 10 pieces per lead) are NOT changed here. This only decides WHEN and HOW FAST.

export type Rng = () => number; // returns [0, 1)

export type PacingConfig = {
  tz: string;
  /** Working day in local time. Each account's day starts a little earlier or later, so accounts never act in sync. */
  dayStartHour: number;
  dayEndHour: number;
  startJitterMinutes: number;
  sessionMinutes: [number, number];
  restMinutes: [number, number];
  lunchFromHour: number;
  lunchMinutes: [number, number];
};

export const DEFAULT_PACING: PacingConfig = {
  tz: "America/New_York",
  dayStartHour: 9,
  dayEndHour: 21,
  startJitterMinutes: 45,
  sessionMinutes: [25, 50],
  restMinutes: [8, 25],
  lunchFromHour: 12.5,
  lunchMinutes: [30, 55],
};

/** What we remember about one account between jobs (saved in the settings table as JSON). */
export type PaceState = {
  sessionEnd: string | null;   // ISO. Working until then.
  restUntil: string | null;    // ISO. Resting until then.
  lunchDay: string | null;     // local date the lunch break was already taken
  nextActionAt: string | null; // ISO. Small gap after the last job so actions are never back to back.
};
export const EMPTY_STATE: PaceState = { sessionEnd: null, restUntil: null, lunchDay: null, nextActionAt: null };

const between = ([a, b]: [number, number], rng: Rng) => a + (b - a) * rng();
const minutes = (n: number) => n * 60_000;

export function localClock(date: Date, tz: string): { dateIso: string; minuteOfDay: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { dateIso: `${p.year}-${p.month}-${p.day}`, minuteOfDay: Number(p.hour) * 60 + Number(p.minute) };
}

/** Same account, same offset every day; different accounts get different offsets. */
export function accountOffsetMinutes(accountId: number, cfg: PacingConfig): number {
  const h = Math.imul(accountId + 7919, 2654435761) >>> 0;
  return Math.round(((h % 1000) / 999) * 2 * cfg.startJitterMinutes - cfg.startJitterMinutes);
}

export type Gate = { ok: true; state: PaceState } | { ok: false; until: Date; state: PaceState; reason: "off_hours" | "resting" | "lunch" | "gap" };

/** May this account act right now? If not, when should it try again. */
export function gate(now: Date, accountId: number, state: PaceState, cfg: PacingConfig, rng: Rng): Gate {
  const st = { ...state };
  const t = now.getTime();

  // 1. Working hours, shifted per account.
  const { dateIso, minuteOfDay } = localClock(now, cfg.tz);
  const off = accountOffsetMinutes(accountId, cfg);
  const start = cfg.dayStartHour * 60 + off, end = cfg.dayEndHour * 60 + off;
  if (minuteOfDay < start || minuteOfDay >= end) {
    const wait = minuteOfDay < start ? start - minuteOfDay : 1440 - minuteOfDay + start;
    return { ok: false, until: new Date(t + minutes(wait)), state: st, reason: "off_hours" };
  }

  // 2. A break that is already running.
  if (st.restUntil && Date.parse(st.restUntil) > t) return { ok: false, until: new Date(st.restUntil), state: st, reason: "resting" };

  // 3. Lunch, once a day, when the clock passes the lunch hour.
  if (st.lunchDay !== dateIso && minuteOfDay >= cfg.lunchFromHour * 60) {
    st.lunchDay = dateIso;
    st.sessionEnd = null;
    st.restUntil = new Date(t + minutes(between(cfg.lunchMinutes, rng))).toISOString();
    return { ok: false, until: new Date(st.restUntil), state: st, reason: "lunch" };
  }

  // 4. Work in sessions, then rest.
  if (!st.sessionEnd) st.sessionEnd = new Date(t + minutes(between(cfg.sessionMinutes, rng))).toISOString();
  if (t >= Date.parse(st.sessionEnd)) {
    st.sessionEnd = null;
    st.restUntil = new Date(t + minutes(between(cfg.restMinutes, rng))).toISOString();
    return { ok: false, until: new Date(st.restUntil), state: st, reason: "resting" };
  }

  // 5. A short gap after the previous job.
  if (st.nextActionAt && Date.parse(st.nextActionAt) > t) return { ok: false, until: new Date(st.nextActionAt), state: st, reason: "gap" };
  return { ok: true, state: st };
}

/** Pause after a finished job before the same account acts again. */
export function gapAfterJob(type: string, rng: Rng): number {
  switch (type) {
    case "qualify": return humanDelayMs("betweenChecks", rng);
    case "warmup": return humanDelayMs("betweenLeads", rng);
    case "send": return humanDelayMs("betweenDms", rng);
    default: return humanDelayMs("betweenChecks", rng);
  }
}

export function afterJob(state: PaceState, type: string, now: Date, rng: Rng): PaceState {
  return { ...state, nextActionAt: new Date(now.getTime() + gapAfterJob(type, rng)).toISOString() };
}

export type DelayKind =
  | "read" | "afterLike" | "beforeComment" | "typeKey" | "beforeSend" | "betweenParts"
  | "betweenPieces" | "betweenChecks" | "betweenLeads" | "betweenDms";

const RANGES_MS: Record<DelayKind, [number, number]> = {
  read: [2_500, 9_000],
  afterLike: [900, 3_000],
  beforeComment: [3_000, 9_000],
  typeKey: [60, 210],
  beforeSend: [800, 2_500],
  betweenParts: [6_000, 22_000],        // time between the three DMs, like a person typing the next one
  betweenPieces: [8_000, 30_000],       // from one post to the next
  betweenChecks: [20_000, 70_000],
  betweenLeads: [90_000, 300_000],      // after a full warm-up
  betweenDms: [180_000, 540_000],       // after a DM
};

/** Human timing: usually short, sometimes much longer (distracted). Always inside sensible bounds. */
export function humanDelayMs(kind: DelayKind, rng: Rng): number {
  const [lo, hi] = RANGES_MS[kind];
  let ms = lo + (hi - lo) * Math.pow(rng(), 1.6);
  if (kind !== "typeKey" && rng() < 0.06) ms *= 1.5 + rng();     // now and then a person stops to look at something
  return Math.round(ms);
}
