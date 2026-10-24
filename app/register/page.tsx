import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { register } from "./actions";

export default function RegisterPage() {
  return <AuthPanel title="Your own workspace" description="Keep your company's campaigns, accounts and conversations private.">
    <AuthForm action={register} submit="Create workspace" fields={[
      { name: "workspaceName", label: "Company or team name", autoComplete: "organization" },
      { name: "name", label: "Your name", autoComplete: "name" },
      { name: "email", label: "Email", type: "email", autoComplete: "email" },
      { name: "password", label: "Password · at least 8 characters", type: "password", autoComplete: "new-password" },
    ]} />
    <p className="mt-5 text-sm text-muted">Already have an account? Use your existing email and password here, or <Link className="text-accent underline" href="/login">sign in</Link>.</p>
    <p className="mt-3 text-sm text-muted">Joining a team? <Link className="text-accent underline" href="/join">Use an invitation</Link></p>
  </AuthPanel>;
}
