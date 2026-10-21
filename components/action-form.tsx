"use client";
import { useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/ui/action-result";

/** Retains non-secret input on validation failures and announces the server result. */
export function ActionForm({ action, children, className = "grid gap-3", id, onResult }: {
  action: (data: FormData) => Promise<ActionResult>; children: ReactNode; className?: string; id?: string; onResult?: (result: ActionResult) => void;
}) {
  const router = useRouter(), pathname = usePathname();
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
      try { const response = await action(data); onResult?.(response); setResult(response); if (response.url?.startsWith("/") && !response.url.startsWith("//") && response.url !== pathname) router.push(response.url); }
      catch { const error = { error: "Couldn’t save this change. Try again shortly." }; onResult?.(error); setResult(error); }
      finally { form.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ""; }); }
    });
  }
  return <form ref={form} id={id} method="post" onSubmit={submit} className={className} aria-busy={pending}>
    <fieldset disabled={pending} className="contents">{children}</fieldset>
    <p ref={feedback} tabIndex={-1} role={result.error ? "alert" : "status"} className={`col-span-full basis-full text-sm ${result.error ? "text-bad" : "text-muted"}`}>{pending ? "Saving…" : result.error ?? result.message}</p>
  </form>;
}
