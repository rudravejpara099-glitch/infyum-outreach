const dateFormatter = (timeZone: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});

/** Calendar date at an instant in the supplied IANA time zone. */
export function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = dateFormatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstInstantOnOrAfter(dateIso: string, timeZone: string): Date {
  // A local day can begin at most 24 hours away from its UTC calendar date.
  let low = Date.parse(`${addDays(dateIso, -2)}T00:00:00Z`);
  let high = Date.parse(`${addDays(dateIso, 3)}T00:00:00Z`);
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (dateInTimeZone(new Date(mid), timeZone) < dateIso) low = mid;
    else high = mid;
  }
  if (dateInTimeZone(new Date(high), timeZone) !== dateIso) {
    throw new RangeError(`Local date ${dateIso} does not exist in ${timeZone}`);
  }
  return new Date(high);
}

/** UTC half-open interval for a local calendar day (also handles 23/25-hour DST days). */
export function utcRangeForLocalDate(dateIso: string, timeZone: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || new Date(`${dateIso}T00:00:00Z`).toISOString().slice(0, 10) !== dateIso) {
    throw new RangeError(`Invalid calendar date: ${dateIso}`);
  }
  return {
    start: firstInstantOnOrAfter(dateIso, timeZone),
    end: firstInstantOnOrAfter(addDays(dateIso, 1), timeZone),
  };
}
