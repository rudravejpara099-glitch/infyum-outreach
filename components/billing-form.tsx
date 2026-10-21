"use client";
import { useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
export type BillingResult = { error?: string; message?: string; field?: string; url?: string };
export function BillingForm({ action, children, className = "billing-form" }: { action: (form: FormData) => Promise<BillingResult>; children: ReactNode; className?: string }) {
  const [result, setResult] = useState<BillingResult>({});
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null), status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (pending || (!result.error && !result.message)) return;
    const field = result.field ? form.current?.elements.namedItem(result.field) : null;
    if (field instanceof HTMLElement) field.focus(); else status.current?.focus();
  }, [pending, result]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setResult({});
    start(async () => {
      try { const response = await action(data); setResult(response); if (response.url) window.location.assign(response.url); }
      catch { setResult({ error: "Couldn’t save this change. Try again shortly." }); }
    });
  }
  return <form ref={form} onSubmit={submit} className={className} aria-busy={pending}>
    <fieldset disabled={pending} className="billing-fields">{children}</fieldset>
    <p ref={status} tabIndex={-1} role={result.error ? "alert" : "status"} className={result.error ? "text-bad" : "text-muted"}>{pending ? "One moment…" : result.error ?? result.message}</p>
  </form>;
}
