import { redirect } from "next/navigation";
import Link from "next/link";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { login } from "./actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default function LoginPage() {
  if (countUsers(getIdentityDb()) === 0) redirect("/setup");
  return (
    <AuthPanel title="Welcome back" description="Sign in to continue your conversations.">
      <AuthForm action={login} submit="Sign in" fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]} />
      <p className="mt-5 text-sm text-muted">New here? <Link className="text-accent underline" href="/register">Create a private workspace</Link></p>
      <p className="mt-3 text-sm text-muted">Invited by your team? <Link className="text-accent underline" href="/join">Join a workspace</Link></p>
    </AuthPanel>
  );
}
