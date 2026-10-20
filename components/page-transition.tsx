"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <div key={path} className="page-content route-enter">{children}</div>;
}
