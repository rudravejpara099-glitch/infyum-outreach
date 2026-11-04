"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page's data every few seconds so a table stays live without a reload. */
export function LiveRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
