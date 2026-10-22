// The pipeline. One list, one transition table. Everything else reads from here.
// Scope (owner decision, 2026-10-20): the app only gets a client to send a first message. "replied" is the hand-off point.
export const STAGES = [
  "found",
  "qualified",
  "warmed",
  "dm_sent",
  "replied",
  "closed",
  "skipped",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  found: "Found",
  qualified: "Qualified",
  warmed: "Warmed up",
  dm_sent: "DM sent",
  replied: "Replied",
  closed: "Stopped",
  skipped: "Skipped",
};

const NEXT: Record<Stage, readonly Stage[]> = {
  found: ["qualified", "replied", "skipped"],
  qualified: ["warmed", "replied", "skipped"],
  warmed: ["dm_sent", "replied", "skipped"],
  dm_sent: ["replied", "closed"],
  replied: ["closed"], // the app's job ends here: a person or the GHL agent takes over from the first reply
  closed: ["replied"], // a stopped lead can come back if they write again
  skipped: ["found"], // retry after a rule change
};

export function canMove(from: Stage, to: Stage): boolean {
  return NEXT[from].includes(to);
}

/** An incoming first DM ends outreach, even if it arrives before our first send. */
export function canSendAtStage(stage: Stage, kind: "dm" | "followup" | "reply" | "incoming"): boolean {
  return (kind === "dm" && stage === "warmed") || (kind === "followup" && stage === "dm_sent");
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
