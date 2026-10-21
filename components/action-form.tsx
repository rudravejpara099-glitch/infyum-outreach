"use client";
import { useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
import type { ActionResult } from "@/lib/ui/action-result";

/** Retains non-secret input on validation failures and announces the server result. */
export function ActionForm({ action, children, className = "grid gap-3" }: {
  action: (data: FormData) => Promise<ActionResult>; children: ReactNode; className?: string;
}) {
  const [result, setResult] = useState<ActionResult>({});
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null), feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (pending || (!result.error && !result.message)) return;
    const field = result.field ? form.current?.elements.namedItem(result.field) : null;
    if (field instanceof HTMLElement) field.focus(); else feedback.current?.focus();
  }, [pending, result]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setResult({});
    start(async () => {
      try { setResult(await action(data)); }
      catch { setResult({ error: "Couldn’t save this change. Try again shortly." }); }
      finally { form.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ""; }); }
    });
  }
  return <form ref={form} onSubmit={submit} className={className} aria-busy={pending}>
    <fieldset disabled={pending} className="contents">{children}</fieldset>
    <p ref={feedback} tabIndex={-1} role={result.error ? "alert" : "status"} className={`col-span-full basis-full text-sm ${result.error ? "text-bad" : "text-muted"}`}>{pending ? "Saving…" : result.error ?? result.message}</p>
  </form>;
}
