"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getIdentityDb, getWorkspaceDb } from "@/lib/workspaces/storage";
import { createInvite, createWorkspace, getMembership, removeMember, revokeInvite } from "@/lib/workspaces/catalog";
import type { ActionResult } from "@/lib/ui/action-result";

export async function createWorkspaceAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await getDb(form);
  let workspace;
  try { workspace = createWorkspace(getIdentityDb(), user.id, String(form.get("name") ?? "")); }
  catch { return { error: "Enter a company name of 1 to 100 characters." }; }
  getWorkspaceDb(workspace.id);
  await createSession(user.id, workspace.id);
  revalidatePath("/", "layout");
  return { url: "/", message: "Your private workspace is ready." };
}

export async function switchWorkspace(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await getDb(form);
  const id = String(form.get("workspaceId") ?? "");
  if (!getMembership(getIdentityDb(), user.id, id)) return { error: "You do not have access to that workspace." };
  await createSession(user.id, id);
  revalidatePath("/", "layout");
  return { url: "/", message: "Workspace changed." };
}

export async function inviteTeammate(form: FormData): Promise<ActionResult & { invitation?: string }> {
  const user = await requireUser();
  await getDb(form);
  if (user.workspaceRole !== "owner") return { error: "Only the workspace owner can invite teammates." };
  try {
    const token = createInvite(getIdentityDb(), user.id, user.workspaceId, String(form.get("email") ?? ""));
    revalidatePath("/workspaces");
    return { invitation: `/join#${token}`, message: "Invitation created. Share this link with the invited person. It expires in 7 days." };
  } catch { return { error: "Enter a valid email address." }; }
}

export async function removeWorkspaceMember(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await getDb(form);
  if (user.workspaceRole !== "owner") return { error: "Only the workspace owner can remove teammates." };
  const id = Number(form.get("userId"));
  if (!Number.isSafeInteger(id) || id < 1) return { error: "Choose a valid teammate." };
  try { removeMember(getIdentityDb(), user.id, user.workspaceId, id); }
  catch { return { error: "The workspace owner cannot be removed." }; }
  revalidatePath("/workspaces"); revalidatePath("/settings");
  return { message: "Teammate removed. Their access to this workspace has ended." };
}

export async function revokeWorkspaceInvite(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await getDb(form);
  if (user.workspaceRole !== "owner") return { error: "Only the workspace owner can cancel invitations." };
  try { revokeInvite(getIdentityDb(), user.id, user.workspaceId, String(form.get("inviteId") ?? "")); }
  catch { return { error: "Invitation not found." }; }
  revalidatePath("/workspaces");
  return { message: "Invitation cancelled. Its link will no longer work." };
}
