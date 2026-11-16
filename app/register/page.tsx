import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { registrationOpen } from "@/lib/auth/registration";
import { register } from "./actions";

export const dynamic = "force-dynamic"; // the sign-up switch is read at request time, never frozen into the build

export default function RegisterPage() {
  if (!registrationOpen()) {
    return <AuthPanel title="Sign-up is closed" description="New workspaces are created by invitation only.">
      <p className="text-sm text-muted">Ask the owner of your team for an invitation, then open it or paste its code.</p>
      <p className="mt-5 text-sm text-muted"><Link className="text-accent underline" href="/join">Use an invitation</Link></p>
      <p className="mt-3 text-sm text-muted">Already a member? <Link className="text-accent underline" href="/login">Sign in</Link></p>
    </AuthPanel>;
  }
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
