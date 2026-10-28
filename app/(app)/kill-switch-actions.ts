"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { setKillSwitch } from "@/lib/services/kill-switch";
import type { ActionResult } from "@/lib/ui/action-result";

export async function stopEverything(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  setKillSwitch(await getDb(form), true, user.email);
  revalidatePath("/", "layout");
  return { message: "Everything is stopped." };
}
export async function resumeEverything(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  setKillSwitch(await getDb(form), false, user.email);
  revalidatePath("/", "layout");
  return { message: "Resumed. Work continues within the limits." };
}
