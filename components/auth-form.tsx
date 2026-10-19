"use client";
import { useActionState } from "react";

type State = { error?: string } | undefined;

export function AuthForm({ action, fields, submit }: {
  action: (prev: State, form: FormData) => Promise<State>;
  fields: { name: string; label: string; type?: string; autoComplete?: string }[];
  submit: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="flex flex-col gap-4">
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>{f.label}</label>
          <input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required className="input" />
        </div>
      ))}
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "One moment…" : submit}</button>
    </form>
  );
}
