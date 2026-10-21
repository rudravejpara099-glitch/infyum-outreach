"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { canMove, isStage } from "@/lib/domain/stages";
import { getLead, moveStage, setNotes } from "@/lib/db/repos/leads";
import { markDoNotContact } from "@/lib/services/outreach";
import type { ActionResult } from "@/lib/ui/action-result";
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
    moveStage(db, id, to, user.email, String(form.get("note") ?? ""));
    return { message: "Lead stage updated." };
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
