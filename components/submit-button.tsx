"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, disabled, primary = false }: { children: ReactNode; disabled?: boolean; primary?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`btn ${primary ? "btn-primary" : ""}`} disabled={disabled || pending} aria-busy={pending}>{pending ? "One moment…" : children}</button>;
}
