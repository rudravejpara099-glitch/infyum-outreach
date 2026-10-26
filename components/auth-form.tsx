"use client";
import { useActionState, useState, type ChangeEvent, type FormEvent } from "react";

type State = { error?: string } | undefined;

export function AuthForm({ action, fields, submit }: {
  action: (prev: State, form: FormData) => Promise<State>;
  fields: { name: string; label: string; type?: string; autoComplete?: string }[];
  submit: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  function retainNonSecretFields(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    setValues(Object.fromEntries(fields.filter(field => field.type !== "password").map(field => [field.name, String(formData.get(field.name) ?? "")])));
  }
  return (
    <form action={run} onSubmit={retainNonSecretFields} className="flex flex-col gap-4">
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>{f.label}</label>
          <input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required className="input"
            {...(f.type === "password" ? {} : { value: values[f.name] ?? "", onChange: (event: ChangeEvent<HTMLInputElement>) => setValues(previous => ({ ...previous, [f.name]: event.target.value })) })} />
        </div>
      ))}
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "One moment…" : submit}</button>
    </form>
  );
}
