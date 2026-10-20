import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { countPendingMessages } from "@/lib/db/repos/messages";
import { logout } from "@/app/login/actions";
import { Nav } from "@/components/nav";
import { Appearance } from "@/components/appearance";
import { Icon } from "@/components/icon";
import { PageTransition } from "@/components/page-transition";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const pending = countPendingMessages(getDb());
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar glass">
        <div>
          <div className="workspace-name">Outreach <span className="workspace-caption">Instagram outreach</span></div>
          <Nav pending={pending} />
        </div>
        <form action={logout} className="sidebar-user">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="user-name">{user.name}<small>Team workspace</small></span>
          <button className="icon-button" title="Sign out" aria-label="Sign out"><Icon name="logout" size={18} /></button>
        </form>
      </aside>
      <main id="main-content" className="workspace-panel" tabIndex={-1}>
        <div className="workspace-toolbar"><span className="workspace-caption">Your outreach workspace</span><Appearance /></div>
        <PageTransition>{children}</PageTransition>
        <footer className="workspace-footer"><span>Local workspace</span><span>Actions stay within your account limits.</span></footer>
      </main>
    </div>
  );
}
