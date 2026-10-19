// The pipeline. One list, one transition table. Everything else reads from here.
export const STAGES = [
  "found",
  "qualified",
  "warmed",
  "dm_sent",
  "replied",
  "call_offered",
  "booked",
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
  call_offered: "Call offered",
  booked: "Booked",
  closed: "Closed",
  skipped: "Skipped",
};

const NEXT: Record<Stage, readonly Stage[]> = {
  found: ["qualified", "skipped"],
  qualified: ["warmed", "skipped"],
  warmed: ["dm_sent", "skipped"],
  dm_sent: ["replied", "closed"],
  replied: ["replied", "call_offered", "closed"],
  call_offered: ["replied", "booked", "closed"],
  booked: ["closed"],
  closed: ["replied"], // a closed lead can come back if they write again
  skipped: ["found"], // retry after a rule change
};

export function canMove(from: Stage, to: Stage): boolean {
  return NEXT[from].includes(to);
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
