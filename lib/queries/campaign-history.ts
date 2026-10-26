import type { Db } from "@/lib/db/core";
import { parseDb } from "@/lib/format";
export type CampaignDay = { date: string; sent: number; replies: number };

/** Actual sent outreach and first real handoffs, grouped by the team's calendar day. */
export function campaignHistory(db: Db, campaignId: number, timeZone: string, now = new Date()): CampaignDay[] {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localDate = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  // Step calendar dates in UTC after obtaining today's local date; a day may have 23 or 25 hours.
  const today = new Date(`${localDate(now)}T12:00:00Z`);
  const days = Array.from({ length: 14 }, (_, index) => ({ date: new Date(today.getTime() - (13 - index) * 86_400_000).toISOString().slice(0, 10), sent: 0, replies: 0 }));
  const lookup = new Map(days.map(day => [day.date, day]));
  const earliest = new Date(`${days[0].date}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 1); // Includes every possible local midnight offset.
  const rows = db.prepare(`SELECT m.sent_at AS ts, 'sent' AS kind FROM messages m JOIN leads l ON l.id=m.lead_id
    WHERE l.campaign_id=? AND m.direction='out' AND m.status='sent' AND m.kind IN ('dm','followup') AND datetime(m.sent_at)>=datetime(?)
    UNION ALL
    SELECT min(a.ts) AS ts, 'replies' AS kind FROM activity a JOIN leads l ON l.id=a.lead_id
    WHERE l.campaign_id=? AND a.action='lead.handoff' GROUP BY a.lead_id`).all(campaignId, earliest.toISOString(), campaignId) as { ts: string; kind: "sent" | "replies" }[];
  for (const row of rows) {
    const date = parseDb(row.ts);
    if (!Number.isFinite(date.getTime()) || date > now) continue;
    const day = lookup.get(localDate(date));
    if (day) day[row.kind]++;
  }
  return days;
}
