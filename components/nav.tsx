"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { navigationCopy } from "@/lib/ui/copy";

const ITEMS = [
  { href: "/", label: navigationCopy["/"], icon: "dashboard" },
  { href: "/campaigns", label: "Campaigns", icon: "campaign" },
  { href: "/pipeline", label: navigationCopy["/pipeline"], icon: "pipeline" },
  { href: "/approvals", label: navigationCopy["/approvals"], icon: "approval" },
  { href: "/inbox", label: navigationCopy["/inbox"], icon: "inbox" },
  { href: "/accounts", label: "Accounts", icon: "accounts" },
  { href: "/activity", label: navigationCopy["/activity"], icon: "activity" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function Nav({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav className="app-nav" aria-label="Main navigation">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={`nav-link ${active ? "nav-active" : ""}`}>
            <Icon name={i.icon as IconName} /><span>{i.label}</span>
            {i.href === "/approvals" && pending > 0 && <span className="badge badge-accent">{pending}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
