import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";

/** Build plan, Phase 2: four action buttons. Each one starts a step; nothing runs on its own until a button is pressed. */
export const STEPS = ["find", "engage", "send", "followup"] as const;
export type Step = typeof STEPS[number];
export const STEP_LABEL: Record<Step, string> = { find: "Find leads", engage: "Engage", send: "Send DMs", followup: "Follow up" };
export const STEP_HELP: Record<Step, string> = {
  find: "Searches for new prospects and checks them against your filters.",
  engage: "Checks found leads, then likes, comments and follows qualified ones.",
  send: "Writes first messages for engaged leads and sends the approved ones.",
  followup: "Writes follow-ups that are due, sends approved ones and looks for replies.",
};

export type RunMode = "buttons" | "automatic";
export const runMode = (db: Db): RunMode => getSetting(db, "run_mode") === "automatic" ? "automatic" : "buttons";

function armed(db: Db): Partial<Record<Step, string>> {
  try { const v = JSON.parse(getSetting(db, "armed_steps") ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export const isArmed = (db: Db, step: Step): boolean => runMode(db) === "automatic" || Boolean(armed(db)[step]);

export function armStep(db: Db, step: Step, by: string, now = new Date()): void {
  db.transaction(() => {
    setSetting(db, "armed_steps", JSON.stringify({ ...armed(db), [step]: now.toISOString() }));
    logActivity(db, by, "step.started", { detail: STEP_LABEL[step] });
  }).immediate();
}

const active = "status IN ('queued','running')";
/** Is any job of this step still waiting or running? (Both first messages and follow-ups use the 'send' job, told apart by the message.) */
export function stepHasWork(db: Db, step: Step): boolean {
  const count = (sql: string) => ((db.prepare(sql).get() as { n: number }).n) > 0;
  const sendOf = (kind: string) => count(`SELECT COUNT(*) n FROM jobs j JOIN messages m ON m.id = json_extract(j.payload,'$.messageId') WHERE j.type='send' AND j.${active} AND m.kind='${kind}'`);
  switch (step) {
    case "find": return count(`SELECT COUNT(*) n FROM jobs WHERE type='find_leads' AND ${active}`);
    case "engage": return count(`SELECT COUNT(*) n FROM jobs WHERE type IN ('qualify','warmup') AND ${active}`);
    case "send": return count(`SELECT COUNT(*) n FROM jobs WHERE type='draft_dm' AND ${active}`) || sendOf("dm");
    case "followup": return count(`SELECT COUNT(*) n FROM jobs WHERE type IN ('draft_followup','check_inbox') AND ${active}`) || sendOf("followup");
  }
}

/** Called after the worker has queued whatever is due: a step with nothing left to do turns itself off. */
export function disarmFinished(db: Db): void {
  if (runMode(db) === "automatic") return;
  const current = armed(db);
  const left = Object.fromEntries(Object.entries(current).filter(([step]) => stepHasWork(db, step as Step)));
  if (Object.keys(left).length !== Object.keys(current).length) setSetting(db, "armed_steps", JSON.stringify(left));
}
