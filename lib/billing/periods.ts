export function isoDay(value = new Date().toISOString()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid date");
  return date.toISOString().slice(0, 10);
}
export function periodFor(value: string) {
  const day = isoDay(value), start = `${day.slice(0, 7)}-01`;
  const next = new Date(start + "T00:00:00Z"); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = isoDay(next.toISOString());
  return { start, end, days: Math.round((Date.parse(end) - Date.parse(start)) / 86400000) };
}
export function closedPeriods(since: string, now: string): string[] {
  const result: string[] = [], end = periodFor(now).start;
  let start = periodFor(since).start;
  while (start < end) {
    result.push(start); start = periodFor(start).end;
    if (result.length > 1200) throw new Error("Period range too large");
  }
  return result;
}
export function daysBetween(start: string, end: string): string[] {
  const result: string[] = [];
  for (let day = isoDay(start); day <= isoDay(end); day = isoDay(new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString())) {
    result.push(day); if (result.length > 36600) throw new Error("Date range too large");
  }
  return result;
}
export function isOverdue(periodEnd: string, now: string): boolean { return Date.parse(now) >= Date.parse(periodEnd.includes("T") ? periodEnd : periodEnd + "T00:00:00Z") + 7 * 86400000; }
