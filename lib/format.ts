import type { Stage } from "@/lib/domain/stages";

/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS". */
export function parseDb(ts: string): Date {
  return new Date(ts.replace(" ", "T") + (ts.includes("T") ? "" : "Z"));
}

export function ago(ts: string | null, now = new Date()): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor((now.getTime() - parseDb(ts).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const number = (n: number | null) => (n == null ? "–" : n.toLocaleString("en-US"));

export const STAGE_BADGE: Record<Stage, string> = {
  found: "badge-muted", qualified: "badge-muted", warmed: "badge-accent", dm_sent: "badge-accent",
  replied: "badge-ok", closed: "badge-muted", skipped: "badge-warn",
};
