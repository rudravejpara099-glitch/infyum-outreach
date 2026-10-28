import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { countPendingMessages } from "@/lib/db/repos/messages";
import { logout } from "@/app/login/actions";
import { Nav } from "@/components/nav";
import { Appearance } from "@/components/appearance";
import { Icon } from "@/components/icon";
import { PageTransition } from "@/components/page-transition";
import { WorkspaceProvider } from "@/components/workspace-context";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { killSwitchOn } from "@/lib/services/kill-switch";
import { resumeEverything, stopEverything } from "./kill-switch-actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const db = await getDb();
  const pending = countPendingMessages(db);
  const stopped = killSwitchOn(db);
  return (
    <WorkspaceProvider id={user.workspaceId}><div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar glass">
        <div>
          <div className="workspace-name">Outreach <span className="workspace-caption">Instagram outreach</span></div>
          <Nav pending={pending} />
          <Link href="/workspaces" title={user.workspaceName} className="btn mt-4 w-full justify-start"><span className="min-w-0 truncate">{user.workspaceName} · Team & workspaces</span></Link>
        </div>
        <form action={logout} className="sidebar-user">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="user-name">{user.name}<small>{user.workspaceName}</small></span>
          <button className="icon-button" title="Sign out" aria-label="Sign out"><Icon name="logout" size={18} /></button>
        </form>
      </aside>
      <main id="main-content" className="workspace-panel" tabIndex={-1}>
        {stopped ? (
          <ActionForm action={resumeEverything} className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-red-50 px-4 py-2 text-sm text-red-900">
            <span><strong>Everything is stopped.</strong> No jobs run and the Chrome extension does nothing until you resume.</span>
            <button className="btn">Resume</button>
          </ActionForm>
        ) : null}
        <div className="workspace-toolbar"><Link href="/workspaces" className="workspace-caption min-w-0 truncate">{user.workspaceName}</Link>{stopped ? null : <ActionForm action={stopEverything}><button className="btn" title="Stop all jobs and the Chrome extension at once">Stop everything</button></ActionForm>}<Appearance /></div>
        <PageTransition>{children}</PageTransition>
        <footer className="workspace-footer"><span>Local workspace</span><span>Actions stay within your account limits.</span></footer>
      </main>
    </div></WorkspaceProvider>
  );
}
