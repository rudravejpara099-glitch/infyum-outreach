import { redirect } from "next/navigation";
import Link from "next/link";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { GOOGLE_MESSAGES, googleEnabled, passwordSignInOff } from "@/lib/auth/google-config";
import { login } from "./actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  if (countUsers(getIdentityDb()) === 0) redirect("/setup");
  const { google } = await searchParams;
  const note = google ? GOOGLE_MESSAGES[google] : undefined;
  const withGoogle = googleEnabled(), passwordOff = passwordSignInOff();
  return (
    <AuthPanel title="Welcome back" description="Sign in to continue your conversations.">
      {note && <p role="alert" className="mb-4 rounded-xl border border-line bg-bg p-3 text-sm">{note}</p>}
      {withGoogle && <a href="/api/auth/google/start" className="btn btn-primary mb-4 w-full justify-center">Continue with Google</a>}
      {!passwordOff && <>
        {withGoogle && <p className="mb-3 text-center text-xs text-muted">or use your email</p>}
        <AuthForm action={login} submit="Sign in" fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]} />
      </>}
      <p className="mt-5 text-sm text-muted">New here? <Link className="text-accent underline" href="/register">Create a private workspace</Link></p>
      <p className="mt-3 text-sm text-muted">Invited by your team? <Link className="text-accent underline" href="/join">Join a workspace</Link></p>
    </AuthPanel>
  );
}
