"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "./action-form";
import { pairMyDevice } from "@/app/(app)/accounts/connect/actions";

export function DevicePairing() {
  const [code, setCode] = useState(""), [copied, setCopied] = useState(false), [expiresAt, setExpiresAt] = useState(0), [expired, setExpired] = useState(false);
  const [checking, startChecking] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (!code || !expiresAt) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [code, expiresAt]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <div className="grid gap-3">
    <ActionForm action={async data => {
      const result = await pairMyDevice(data);
      if (result.code) {
        setCode(btoa(JSON.stringify({ origin: window.location.origin, code: result.code })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""));
        setExpiresAt(result.expiresAt ?? 0); setExpired(false);
      }
      setCopied(false); return result;
    }}><button className="btn w-fit">Create connection code</button></ActionForm>
    {code && !expired && <div><label className="label" htmlFor="deviceCode">Connection code</label><input id="deviceCode" className="input" readOnly value={code} onFocus={event => event.currentTarget.select()} /><button className="btn mt-2" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { document.getElementById("deviceCode")?.focus(); } }}>{copied ? "Copied" : "Copy connection code"}</button></div>}
    {expired && <p role="status" className="text-sm text-warn">This code has expired. Create a new connection code above.</p>}
    <p className="text-sm text-muted">Paste the code into Outreach Connector. Check the website address there before connecting. Keep this code private.</p>
    <p className="text-xs text-muted">Connection status updates automatically while this page is open.</p>
    <button className="btn w-fit" disabled={checking} onClick={() => startChecking(() => router.refresh())}>{checking ? "Checking connection…" : "Refresh connection"}</button>
  </div>;
}
