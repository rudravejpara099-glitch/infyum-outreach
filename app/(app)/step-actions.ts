"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listCampaigns } from "@/lib/db/repos/campaigns";
import { setSetting } from "@/lib/db/repos/settings";
import { logActivity } from "@/lib/db/repos/activity";
import { workerStatus } from "@/lib/queries/worker-status";
import { killSwitchOn } from "@/lib/services/kill-switch";
import { armStep, STEPS, STEP_LABEL, type Step } from "@/lib/services/run-steps";
import { findLeads } from "./campaigns/actions";
import type { ActionResult } from "@/lib/ui/action-result";

export async function runStep(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const step = String(form.get("step") ?? "") as Step;
  if (!STEPS.includes(step)) return { error: "Unknown action." };
  const db = await getDb(form);
  if (killSwitchOn(db)) return { error: "Everything is stopped. Resume first, using the banner at the top." };
  const notes: string[] = [];
  if (step === "find") {
    const campaigns = listCampaigns(db).filter((c) => c.status === "active");
    if (campaigns.length === 0) return { error: "No active campaign. Start a campaign first." };
    for (const campaign of campaigns) {
      const searchForm = new FormData();
      for (const [key, value] of form.entries()) if (key.startsWith("__")) searchForm.set(key, value);
      searchForm.set("id", String(campaign.id));
      const result = await findLeads(searchForm);
      if ("error" in result && result.error) notes.push(`${campaign.name}: ${result.error}`);
    }
    if (notes.length === campaigns.length) return { error: notes.join(" ") };
  }
  armStep(db, step, user.email);
  revalidatePath("/");
  const running = workerStatus(db, new Date()).running;
  return { message: `${STEP_LABEL[step]} started.${running ? "" : " Outreach is stopped, so it will begin when you start it."}${notes.length ? ` ${notes.join(" ")}` : ""}` };
}

export async function saveRunMode(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const mode = form.get("runMode") === "automatic" ? "automatic" : "buttons";
  const db = await getDb(form);
  db.transaction(() => { setSetting(db, "run_mode", mode); logActivity(db, user.email, "settings.run_mode", { detail: mode }); }).immediate();
  revalidatePath("/settings"); revalidatePath("/");
  return { message: mode === "buttons" ? "Work now starts only when you press an action button." : "Outreach now runs every step on its own." };
}
