"use client";
import { useActionState, useEffect, useRef } from "react";
import { join } from "@/app/join/actions";

export function JoinForm() {
  const [state, run, pending] = useActionState(join, undefined);
  const tokenInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Fragments stay on this device; invite secrets never enter a page request URL.
    const value = window.location.hash.slice(1);
    if (value && value.length <= 256 && tokenInput.current) {
      tokenInput.current.value = value;
      tokenInput.current.defaultValue = value;
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  return <form action={run} className="flex flex-col gap-4">
    <div><label className="label" htmlFor="token">Invitation code</label><input className="input" id="token" name="token" ref={tokenInput} onChange={event => { event.currentTarget.defaultValue = event.currentTarget.value; }} autoComplete="off" spellCheck={false} required maxLength={256} /></div>
    <div><label className="label" htmlFor="email">Invited email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required maxLength={254} /></div>
    <div><label className="label" htmlFor="name">Your name <span className="text-muted">(for a new account)</span></label><input className="input" id="name" name="name" autoComplete="name" maxLength={100} /></div>
    <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} /><p className="mt-2 text-xs text-muted">Use your existing password, or choose at least 8 characters for a new account.</p></div>
    {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    <button className="btn btn-primary" disabled={pending}>{pending ? "Joining…" : "Join team"}</button>
  </form>;
}
