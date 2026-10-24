import "server-only";
import { requireUser } from "@/lib/auth/dal";
import { getWorkspaceDb } from "@/lib/workspaces/storage";
import { workspaceFormMatches } from "@/lib/domain/workspace-rules";
import type { Db } from "./core";

export type { Db };

/** Every interactive read/write resolves from a verified current membership. */
export async function getDb(form?: FormData): Promise<Db> {
  const user = await requireUser();
  if (form && !workspaceFormMatches(user.workspaceId, form.get("__workspace"))) {
    throw new Error("Your workspace changed. Refresh this page before saving.");
  }
  return getWorkspaceDb(user.workspaceId);
}
