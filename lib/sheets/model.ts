import type { Db } from "@/lib/db/core";
import type { Lead } from "@/lib/db/types";
import type { Stage } from "@/lib/domain/stages";

// The Google Sheet is the team's view of the pipeline (Sunil's "Architecture and Build Plan", Google Sheet section).
// This file is pure shape: tab names, headers, and how app rows become sheet rows. Secrets never go here.

export type Cell = string | number;
export type TabSpec = {
  name: string;
  headers: string[];
  /** Column that identifies a row, so a write can update in place instead of duplicating. */
  keyColumn: number;
  /** A fixed list of allowed values for one column, shown as a dropdown. */
  dropdown?: { column: number; values: string[] };
};

/** The nine stages in the document. The app uses seven; "Follow-up due" and "Call booked" are set by people after the hand-off. */
export const SHEET_STAGES = ["Found", "Qualified", "Engaged", "DM sent", "Replied", "Follow-up due", "Call booked", "Closed", "Dead"] as const;
export const STAGE_TO_SHEET: Record<Stage, (typeof SHEET_STAGES)[number]> = {
  found: "Found", qualified: "Qualified", warmed: "Engaged", dm_sent: "DM sent", replied: "Replied", closed: "Closed", skipped: "Dead",
};

/** Stages only a person can set, after the hand-off. The sync never overwrites them. */
export const HUMAN_ONLY_STAGES: readonly string[] = ["Follow-up due", "Call booked"];

/** Sheet stage name to app stage, for edits made in the Sheet. "Dead" closes a lead the app has already messaged. */
export function stageFromSheet(name: string, current: Stage): Stage[] | null {
  switch (name) {
    case "Found": return ["found"];
    case "Qualified": return ["qualified"];
    case "Engaged": return ["warmed"];
    case "DM sent": return ["dm_sent"];
    case "Replied": return ["replied"];
    case "Closed": return ["closed"];
    case "Dead": return current === "dm_sent" || current === "replied" ? ["closed"] : ["skipped", "closed"];
    default: return null; // "Follow-up due" and "Call booked" have no app stage
  }
}

export const LEADS_HEADERS = [
  "username", "name", "profile_url", "niche", "followers",
  "engagement_rate", "last_post_date", "bio_link", "fit_score", "source",
  "actions_done", "comment_text", "engaged_at",
  "dm_text", "dm_at", "reply_status", "reply_date", "next_followup_due",
  "stage", "notes",
];

export const TABS: TabSpec[] = [
  { name: "Leads", headers: LEADS_HEADERS, keyColumn: 0, dropdown: { column: LEADS_HEADERS.indexOf("stage"), values: [...SHEET_STAGES] } },
  { name: "Settings", headers: ["key", "value"], keyColumn: 0 },
  { name: "Jobs", headers: ["id", "type", "username", "status", "run_after", "attempts", "last_error", "created_at"], keyColumn: 0 },
  { name: "Activity Log", headers: ["id", "time", "actor", "action", "username", "detail"], keyColumn: 0 },
  { name: "Do-not-contact", headers: ["username", "reason", "added_at"], keyColumn: 0 },
];
export const TAB_NAMES = TABS.map((t) => t.name);
export type TabName = "Leads" | "Settings" | "Jobs" | "Activity Log" | "Do-not-contact";

/** Settings that are safe to show in the sheet. Keys, tokens and anything not listed stay out. */
export const SHEET_SETTING_KEYS = ["prospect_filters", "writing_settings", "portfolio_link", "team_timezone", "run_mode"] as const;

export const normUsername = (value: string) => value.trim().replace(/^@/, "").toLowerCase();

/** A sheet cell that starts with = + - @ would run as a formula; keep text as text. */
export function safeCell(value: string | number | null | undefined): Cell {
  if (typeof value === "number") return value;
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

type LeadExtras = { dmText: string; dmAt: string; comments: string; engagedAt: string; actions: string };

export function leadExtras(db: Db, leadId: number): LeadExtras {
  const dm = db.prepare("SELECT parts, sent_at FROM messages WHERE lead_id=? AND direction='out' AND kind='dm' AND status='sent' ORDER BY id DESC LIMIT 1").get(leadId) as { parts: string; sent_at: string | null } | undefined;
  const acts = db.prepare("SELECT ts, action, detail FROM activity WHERE lead_id=? ORDER BY id").all(leadId) as { ts: string; action: string; detail: string }[];
  return {
    dmText: dm ? (JSON.parse(dm.parts) as string[]).join("\n\n") : "",
    dmAt: dm?.sent_at ?? "",
    comments: acts.filter((a) => a.action === "warmup.comment").map((a) => a.detail).filter(Boolean).join(" | "),
    engagedAt: acts.find((a) => a.action === "lead.warmed_up")?.ts ?? "",
    actions: [...new Set(acts.map((a) => a.action))].filter((a) => a.startsWith("warmup.") || a.startsWith("lead.") || a.startsWith("message.sent")).join(", "),
  };
}

export function leadRow(lead: Lead, extras: LeadExtras, keepStage?: string): Cell[] {
  const note = [lead.skipReason && `skipped: ${lead.skipReason}`, lead.notes].filter(Boolean).join(" | ");
  return [
    safeCell(normUsername(lead.handle)), "", `https://www.instagram.com/${normUsername(lead.handle)}/`, safeCell(lead.niche), lead.followers ?? "",
    "", "", "", lead.fitScore ?? "", safeCell(lead.source),
    safeCell(extras.actions), safeCell(extras.comments), extras.engagedAt,
    safeCell(extras.dmText), extras.dmAt, "", "", "",
    keepStage ?? STAGE_TO_SHEET[lead.stage], safeCell(note),
  ];
}
