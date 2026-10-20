"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { approveMessage, rejectMessage } from "@/lib/db/repos/messages";

export async function approve(form: FormData) {
  const user = await requireUser();
  const parts = form.getAll("part").map((p) => String(p).trim()).filter(Boolean);
  if (parts.length === 0) return { error: "Write a message before approving it, or choose Don’t send." };
  approveMessage(getDb(), Number(form.get("id")), user.email, parts);
  revalidatePath("/approvals");
}

export async function reject(form: FormData) {
  const user = await requireUser();
  rejectMessage(getDb(), Number(form.get("id")), user.email);
  revalidatePath("/approvals");
}
