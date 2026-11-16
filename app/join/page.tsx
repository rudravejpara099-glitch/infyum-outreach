import Link from "next/link";
import { AuthPanel } from "@/components/auth-panel";
import { JoinForm } from "@/components/join-form";
import { registrationOpen } from "@/lib/auth/registration";

export const dynamic = "force-dynamic"; // the sign-up switch is read at request time, never frozen into the build

export default function JoinPage() {
  return <AuthPanel title="Join your team" description="Open your team's invitation or paste its code below. Use the email your team invited.">
    <JoinForm />
    {registrationOpen() && <p className="mt-5 text-sm text-muted">Need your own workspace? <Link className="text-accent underline" href="/register">Create one</Link></p>}
    <p className="mt-3 text-sm text-muted">Already a member? <Link className="text-accent underline" href="/login">Sign in</Link></p>
  </AuthPanel>;
}
