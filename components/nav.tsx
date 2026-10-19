"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/approvals", label: "Approvals" },
  { href: "/inbox", label: "Inbox" },
  { href: "/accounts", label: "Accounts" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-accent-soft font-medium text-accent-strong" : "text-muted hover:bg-bg hover:text-ink"}`}>
            {i.label}
            {i.href === "/approvals" && pending > 0 && <span className="badge badge-accent">{pending}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
