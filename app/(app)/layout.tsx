import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listMessages } from "@/lib/db/repos/messages";
import { logout } from "@/app/login/actions";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const pending = listMessages(getDb(), { status: "pending_approval", limit: 999 }).length;
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px]">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col justify-between border-r border-line p-4">
        <div className="flex flex-col gap-6">
          <div className="px-3 pt-1 font-display text-base font-semibold">Infyum Outreach</div>
          <Nav pending={pending} />
        </div>
        <form action={logout} className="px-3">
          <div className="mb-2 truncate text-xs text-muted">{user.name}</div>
          <button className="btn w-full">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
