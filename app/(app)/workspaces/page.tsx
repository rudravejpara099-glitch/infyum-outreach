import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { listInvites, listMembers, listWorkspaces } from "@/lib/workspaces/catalog";
import { PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { InviteForm } from "@/components/invite-form";
import { createWorkspaceAction, removeWorkspaceMember, revokeWorkspaceInvite, switchWorkspace } from "./actions";

export const dynamic = "force-dynamic";
export default async function WorkspacesPage() {
  const user = await requireUser();
  const db = getIdentityDb();
  const workspaces = listWorkspaces(db, user.id), members = listMembers(db, user.workspaceId);
  const owner = user.workspaceRole === "owner";
  const invites = owner ? listInvites(db, user.workspaceId) : [];
  return <>
    <PageHeader title="Team & workspaces" sub="Keep each company’s campaigns, accounts and costs together." />
    <div className="grid max-w-3xl gap-6">
      <section className="card p-5">
        <h2 className="text-base font-semibold">Your workspaces</h2>
        <ul className="mt-3 divide-y divide-line">{workspaces.map(workspace => <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><strong className="break-words">{workspace.name}</strong><p className="text-xs text-muted">{workspace.role === "owner" ? "Owner" : "Teammate"}{workspace.id === user.workspaceId ? " · Current workspace" : ""}</p></div>
          {workspace.id !== user.workspaceId && <ActionForm action={switchWorkspace}><input type="hidden" name="workspaceId" value={workspace.id} /><button className="btn" aria-label={`Switch to ${workspace.name}`}>Switch workspace</button></ActionForm>}
        </li>)}</ul>
        <p className="mt-3 text-sm text-muted">Have a team invitation? <Link className="text-link" href="/join">Join a workspace</Link>.</p>
      </section>
      <section className="card p-5">
        <h2 className="text-base font-semibold">{user.workspaceName} team</h2>
        <p className="mt-1 text-sm text-muted">Teammates share this workspace. Other companies cannot see its data.</p>
        <ul className="my-3 divide-y divide-line">{members.map(member => <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 break-words"><strong>{member.name}{member.id === user.id ? " (you)" : ""}</strong><p className="text-sm text-muted">{member.email} · {member.role === "owner" ? "Owner" : "Teammate"}</p></div>
          {owner && member.role !== "owner" && <ActionForm action={removeWorkspaceMember} confirmMessage={`Remove ${member.name} from this workspace? Their access ends immediately.`}><input name="userId" type="hidden" value={member.id} /><button className="btn btn-danger" aria-label={`Remove ${member.email}`}>Remove</button></ActionForm>}
        </li>)}</ul>
        {owner ? <InviteForm /> : <p className="text-sm text-muted">The workspace owner manages invitations and team access.</p>}
        {invites.length > 0 && <div className="mt-5"><h3 className="font-medium">Pending invitations</h3><ul className="divide-y divide-line">{invites.map(invite => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="min-w-0 break-words">{invite.email}<small className="block text-muted">Expires {new Date(invite.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</small></span><ActionForm action={revokeWorkspaceInvite}><input name="inviteId" type="hidden" value={invite.id} /><button className="btn">Cancel invitation</button></ActionForm></li>)}</ul></div>}
      </section>
      <details className="card p-5"><summary className="cursor-pointer font-semibold">Create another company workspace</summary>
        <p className="my-3 text-sm text-muted">Start with an empty private workspace. Invite your team when you’re ready.</p>
        <ActionForm action={createWorkspaceAction}><div><label className="label" htmlFor="workspaceName">Company name</label><input id="workspaceName" name="name" className="input" required maxLength={100} autoComplete="organization" /></div><button className="btn w-fit">Create workspace</button></ActionForm>
      </details>
    </div>
  </>;
}
