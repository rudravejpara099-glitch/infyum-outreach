"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { isStage } from "@/lib/domain/stages";
import { moveStage, setNotes } from "@/lib/db/repos/leads";
import { markDoNotContact } from "@/lib/services/outreach";

export async function changeStage(form: FormData) {
  const user = await requireUser();
  const to = String(form.get("to"));
  if (!isStage(to)) throw new Error("Unknown stage");
  const id = Number(form.get("id"));
  moveStage(getDb(), id, to, user.email, String(form.get("note") ?? ""));
  revalidatePath(`/leads/${id}`);
}

export async function saveNotes(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  setNotes(getDb(), id, String(form.get("notes") ?? ""));
  revalidatePath(`/leads/${id}`);
}

export async function doNotContact(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  markDoNotContact(getDb(), id, String(form.get("reason") || "Asked to stop"), user.email);
  revalidatePath(`/leads/${id}`);
}
