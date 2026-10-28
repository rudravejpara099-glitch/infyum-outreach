// Build plan, Settings and Safety rules: daily caps per action and active hours, all editable. Pure: no database.
export type ActionCaps = { follows: number; likes: number; comments: number; dms: number };
export type SafetySettings = { dayStartHour: number; dayEndHour: number; caps: ActionCaps };

/** The plan sets no numbers for the caps, only that they exist and the week-one ramp applies on top. */
export const DEFAULT_SAFETY: SafetySettings = { dayStartHour: 9, dayEndHour: 21, caps: { follows: 20, likes: 120, comments: 40, dms: 35 } };

const CAP_KEYS = ["follows", "likes", "comments", "dms"] as const;
const int = (v: unknown, min: number, max: number, fallback: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

export function parseSafetySettings(raw: string | null): SafetySettings {
  let saved: { dayStartHour?: unknown; dayEndHour?: unknown; caps?: Record<string, unknown> } = {};
  try { const v = raw ? JSON.parse(raw) : {}; if (v && typeof v === "object") saved = v; } catch { /* use defaults */ }
  const start = int(saved.dayStartHour, 0, 23, DEFAULT_SAFETY.dayStartHour), end = int(saved.dayEndHour, 1, 24, DEFAULT_SAFETY.dayEndHour);
  const caps = { ...DEFAULT_SAFETY.caps };
  for (const k of CAP_KEYS) caps[k] = int(saved.caps?.[k], 0, 1000, caps[k]);
  return end > start ? { dayStartHour: start, dayEndHour: end, caps } : { ...DEFAULT_SAFETY, caps };
}

export function safetyFromForm(values: Record<string, string>): { safety: SafetySettings } | { error: { field: string; message: string } } {
  const num = (field: string, label: string, min: number, max: number): number | { error: { field: string; message: string } } => {
    const raw = (values[field] ?? "").trim();
    if (!/^\d{1,4}$/.test(raw) || Number(raw) < min || Number(raw) > max) return { error: { field, message: `${label} must be a whole number from ${min} to ${max}.` } };
    return Number(raw);
  };
  const start = num("dayStartHour", "Start hour", 0, 23); if (typeof start !== "number") return start;
  const end = num("dayEndHour", "End hour", 1, 24); if (typeof end !== "number") return end;
  if (end <= start) return { error: { field: "dayEndHour", message: "The end hour must be later than the start hour." } };
  const caps = { ...DEFAULT_SAFETY.caps };
  for (const [k, label] of [["follows", "Follows"], ["likes", "Likes"], ["comments", "Comments"], ["dms", "DMs"]] as const) {
    const n = num(`${k}Cap`, `${label} per day`, 0, 1000); if (typeof n !== "number") return n; caps[k] = n;
  }
  return { safety: { dayStartHour: start, dayEndHour: end, caps } };
}
