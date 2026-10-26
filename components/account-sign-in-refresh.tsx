"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Mounted only while a latest account sign-in check is pending. Reads status; starts no work. */
export function AccountSignInRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const watch = () => { if (document.visibilityState === "visible") timer = setInterval(refresh, 3000); };
    const visibilityChanged = () => { stop(); refresh(); watch(); };
    watch();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { stop(); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [router]);
  return null;
}
