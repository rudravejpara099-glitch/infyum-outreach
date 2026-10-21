"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refreshes real server evidence; does not start a worker or perform outreach. */
export function WorkerStatusRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <button type="button" className="btn" disabled={pending} onClick={() => start(() => router.refresh())}>{pending ? "Checking…" : "Check worker status"}</button>;
}
