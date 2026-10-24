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

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const pending = countPendingMessages((await getDb()));
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
        <div className="workspace-toolbar"><Link href="/workspaces" className="workspace-caption min-w-0 truncate">{user.workspaceName}</Link><Appearance /></div>
        <PageTransition>{children}</PageTransition>
        <footer className="workspace-footer"><span>Local workspace</span><span>Actions stay within your account limits.</span></footer>
      </main>
    </div></WorkspaceProvider>
  );
}
