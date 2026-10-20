"use client";
import { useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
import type { FormFeedback } from "@/lib/ui/form-feedback";

/** Keep entered values on failure; password fields never enter React state. No redirect actions. */
export function FeedbackForm({ action, secondaryAction, children, className, success = "Saved." }: {
  action: (form: FormData) => Promise<FormFeedback | void>;
  secondaryAction?: (form: FormData) => Promise<FormFeedback | void>;
  children: ReactNode;
  className?: string;
  success?: string;
}) {
  const [feedback, setFeedback] = useState<FormFeedback>({});
  const [pending, startTransition] = useTransition();
  const status = useRef<HTMLParagraphElement>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(form);
    const run = submitter instanceof HTMLButtonElement && submitter.value === "secondary" && secondaryAction ? secondaryAction : action;
    setFeedback({});
    startTransition(async () => {
      try {
        const result = await run(data);
        setFeedback(result ?? { message: success });
        if (!result?.error) form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ""; });
        if (result?.field) {
          const field = form.elements.namedItem(result.field);
          if (field instanceof HTMLElement) {
            let parent = field.parentElement;
            while (parent && parent !== form) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
            field.focus();
          }
        } else status.current?.focus();
      } catch {
        setFeedback({ error: "Couldn’t save this change. Check your connection and try again. If it keeps happening, ask the person who set up this workspace." });
        status.current?.focus();
      }
    });
  }
  return <form onSubmit={submit} className={className} aria-busy={pending}>
    <fieldset disabled={pending} className="feedback-fields">{children}</fieldset>
    <p ref={status} tabIndex={-1} role={feedback.error ? "alert" : "status"} className={`form-feedback ${feedback.error ? "text-bad" : "text-muted"}`}>{pending ? "Saving…" : feedback.error ?? feedback.message}</p>
  </form>;
}
