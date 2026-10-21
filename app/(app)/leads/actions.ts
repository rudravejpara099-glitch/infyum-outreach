"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { canMove, isStage } from "@/lib/domain/stages";
import { getLead, moveStage, setNotes } from "@/lib/db/repos/leads";
import { markDoNotContact } from "@/lib/services/outreach";
import type { ActionResult } from "@/lib/ui/action-result";
import { isDnc } from "@/lib/db/repos/dnc";
import { getCampaign } from "@/lib/db/repos/campaigns";
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
function refresh(id: number) { revalidatePath(`/leads/${id}`); revalidatePath("/pipeline"); revalidatePath("/"); }

export async function changeStage(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), to = String(form.get("to")), db = getDb();
  if (!validId(id) || !isStage(to)) return { error: "Choose a valid lead and stage." };
  const result: ActionResult = db.transaction(() => {
    const lead = getLead(db, id);
    if (!lead) return { error: "This lead could not be found. Refresh the page." };
    if (!canMove(lead.stage, to)) return { error: "This stage change is not available. Refresh the page to see the current options." };
    if (to === "found") {
      if (isDnc(db, lead.handle)) return { error: "This handle is on Do not contact. Checks cannot be restarted." };
      if (!lead.campaignId || !getCampaign(db, lead.campaignId)) return { error: "This lead needs a campaign before checks can restart." };
      const contacted = db.prepare("SELECT 1 FROM messages WHERE lead_id=? AND (direction='in' OR status='sent') UNION ALL SELECT 1 FROM activity WHERE lead_id=? AND action='lead.handoff' LIMIT 1").get(id, id);
      if (contacted) return { error: "Previously contacted leads cannot be restarted. Their conversation history stays intact." };
    }
    moveStage(db, id, to, user.email, String(form.get("note") ?? ""));
    return { message: to === "found" ? "Ready for fresh checks. They run when the campaign is active and the worker is running." : "Lead stage updated." };
  }).immediate();
  refresh(id); return result;
}
export async function saveNotes(form: FormData): Promise<ActionResult> {
  await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id) || !getLead(db, id)) return { error: "This lead could not be found. Refresh the page." };
  setNotes(db, id, String(form.get("notes") ?? ""));
  revalidatePath(`/leads/${id}`); return { message: "Notes saved." };
}
export async function doNotContact(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!validId(id) || !getLead(db, id)) return { error: "This lead could not be found. Refresh the page." };
  const reason = String(form.get("reason") || "Asked to stop").trim();
  if (reason.length > 500) return { error: "Keep the reason under 500 characters.", field: "reason" };
  db.transaction(() => markDoNotContact(db, id, reason, user.email)).immediate();
  refresh(id); revalidatePath("/settings");
  return { message: "Outreach stopped. This handle is on Do not contact." };
}
