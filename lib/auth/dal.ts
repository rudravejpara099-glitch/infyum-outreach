import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getIdentityDb, getWorkspacePaths } from "@/lib/workspaces/storage";
import { getMembership } from "@/lib/workspaces/catalog";
import { getUser, countUsers } from "@/lib/db/repos/users";
import { readSession } from "./session";

/** Every protected request rechecks the current membership and revocable session. */
export const requireUser = cache(async () => {
  const db = getIdentityDb(), session = await readSession();
  const user = session ? getUser(db, session.userId) : null;
  const workspace = session ? getMembership(db, session.userId, session.workspaceId) : null;
  if (!user || !workspace) redirect(countUsers(db) === 0 ? "/setup" : "/login");
  return {
    ...user, workspaceId: workspace.id, workspaceName: workspace.name, workspaceRole: workspace.role,
    hostChromeAllowed: getWorkspacePaths(workspace.id).hostChromeAllowed,
  };
});
