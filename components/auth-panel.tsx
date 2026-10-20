import type { ReactNode } from "react";
import { Appearance } from "./appearance";

export function AuthPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-page"><div className="auth-appearance"><Appearance /></div><section className="auth-panel"><p className="auth-caption">Outreach workspace</p><h1>{title}</h1><p className="auth-description">{description}</p>{children}<p className="auth-footnote">Your workspace runs on this computer.</p></section></main>;
}
