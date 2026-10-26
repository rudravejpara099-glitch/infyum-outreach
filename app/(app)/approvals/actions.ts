"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { approveMessage, getMessage, rejectMessage } from "@/lib/db/repos/messages";
import { recentSentTexts } from "@/lib/db/repos/messages";
import { reviewDraft } from "./review";
import type { ActionResult } from "@/lib/ui/action-result";

export async function approve(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = (await getDb(form));
  if (!Number.isSafeInteger(id) || id <= 0) return { error: "Draft not found. Refresh this page." };
  const result: ActionResult = db.transaction(() => {
    const checked = reviewDraft(db, id, form.getAll("part"));
    if (!checked.parts) return { error: checked.error, field: "part" };
    approveMessage(db, id, user.email, checked.parts);
    return { message: "Draft approved and queued. Account limits and working hours still apply." };
  }).immediate();
  revalidatePath("/approvals"); revalidatePath("/");
  if (!result.error) revalidatePath("/campaigns");
  return result;
}
export async function reject(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = Number(form.get("id")), db = (await getDb(form));
  if (!Number.isSafeInteger(id) || id <= 0) return { error: "Draft not found. Refresh this page." };
  const result: ActionResult = db.transaction(() => {
    const message = getMessage(db, id);
    if (!message || message.status !== "pending_approval") return { error: "This draft is no longer waiting. Refresh this page." };
    rejectMessage(db, id, user.email); return { message: "Draft rejected." };
  }).immediate();
  revalidatePath("/approvals"); revalidatePath("/");
  return result;
}

/** All validation finishes before any draft in the selection is changed. */
export async function approveSelected(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (form.get("reviewed") !== "on") return { error: "Confirm that you reviewed every selected draft." };
  const raw = form.getAll("selected").map(String);
  if (!raw.length || raw.length > 100 || raw.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) || new Set(raw).size !== raw.length) return { error: "Select 1 to 100 different drafts to approve." };
  const db = (await getDb(form));
  const result: ActionResult = db.transaction(() => {
    const recent = recentSentTexts(db), checked: { id: number; parts: string[] }[] = [];
    for (const id of raw) {
      const draft = reviewDraft(db, Number(id), form.getAll(`part-${id}`), true, recent);
      if (!draft.parts) return { error: draft.error };
      checked.push({ id: Number(id), parts: draft.parts });
      recent.push(draft.parts.join(" "));
    }
    for (const draft of checked) approveMessage(db, draft.id, user.email, draft.parts);
    return { message: `${checked.length} draft${checked.length === 1 ? "" : "s"} approved and queued. Account limits and working hours still apply.` };
  }).immediate();
  revalidatePath("/approvals"); revalidatePath("/"); revalidatePath("/campaigns");
  return result;
}
