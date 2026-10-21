"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { approveMessage, getMessage, rejectMessage } from "@/lib/db/repos/messages";
import { getLead } from "@/lib/db/repos/leads";
import { isDnc } from "@/lib/db/repos/dnc";
import { checkDraft, parseParts } from "@/lib/engine/validate";
import type { ActionResult } from "@/lib/ui/action-result";

export async function approve(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!Number.isSafeInteger(id) || id <= 0) return { error: "Draft not found. Refresh this page." };
  const result: ActionResult = db.transaction(() => {
    const message = getMessage(db, id);
    if (!message || message.status !== "pending_approval") return { error: "This draft is no longer waiting. Refresh this page." };
    if (message.kind === "reply" || message.kind === "incoming") return { error: "The app stops at the first reply. Reject this retired draft and hand the conversation to a person." };
    const lead = getLead(db, message.leadId);
    if (!lead || ["replied", "closed", "skipped"].includes(lead.stage) || isDnc(db, lead.handle)) return { error: "This lead has replied or outreach was stopped. This draft cannot be approved." };
    let parts: string[];
    try { parts = parseParts(JSON.stringify({ parts: form.getAll("part").map(String) })); }
    catch { return { error: "Each message must contain 1 to 600 characters. Keep all parts of the draft.", field: "part" }; }
    const error = checkDraft(parts, message.kind);
    if (error) return { error, field: "part" };
    approveMessage(db, id, user.email, parts);
    return { message: "Draft approved and queued. Account limits and working hours still apply." };
  }).immediate();
  revalidatePath("/approvals"); revalidatePath("/");
  if (!result.error) revalidatePath("/campaigns");
  return result;
}
export async function reject(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = getDb();
  if (!Number.isSafeInteger(id) || id <= 0) return { error: "Draft not found. Refresh this page." };
  const result: ActionResult = db.transaction(() => {
    const message = getMessage(db, id);
    if (!message || message.status !== "pending_approval") return { error: "This draft is no longer waiting. Refresh this page." };
    rejectMessage(db, id, user.email); return { message: "Draft rejected." };
  }).immediate();
  revalidatePath("/approvals"); revalidatePath("/");
  return result;
}
