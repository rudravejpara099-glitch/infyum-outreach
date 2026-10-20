import type { Stage } from "@/lib/domain/stages";

export type Lead = {
  id: number;
  handle: string;
  followers: number | null;
  niche: string;
  country: string | null;
  source: string;
  stage: Stage;
  skipReason: string;
  campaignId: number | null;
  accountId: number | null;
  followupsSent: number;
  nextFollowupAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Campaign = {
  id: number;
  name: string;
  niches: string[];
  audienceText: string;
  country: string;
  minFollowers: number;
  maxFollowers: number;
  approvalRequired: boolean;
  followupsEnabled: boolean;
  status: "draft" | "active" | "paused" | "done";
  createdAt: string;
};

export type IgAccount = {
  id: number;
  handle: string;
  label: string;
  profileDir: string;
  dailyCap: number;
  rampStart: string;
  status: "active" | "paused" | "blocked";
  statusNote: string;
};

export type MessageKind = "dm" | "reply" | "followup" | "incoming";
export type MessageStatus = "draft" | "pending_approval" | "approved" | "sent" | "failed" | "rejected";

export type Message = {
  id: number;
  leadId: number;
  accountId: number | null;
  direction: "out" | "in";
  kind: MessageKind;
  parts: string[];
  status: MessageStatus;
  approvalReasons: string[];
  createdAt: string;
  sentAt: string | null;
};

export type Job = {
  id: number;
  type: string;
  leadId: number | null;
  accountId: number | null;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  runAfter: string;
  attempts: number;
  lastError: string;
};

export type ActivityRow = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  leadId: number | null;
  accountId: number | null;
  detail: string;
};
