import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { login } from "./actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default function LoginPage() {
  if (countUsers(getDb()) === 0) redirect("/setup");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Infyum Outreach</h1>
        <p className="mt-1 text-muted">Sign in to continue.</p>
      </div>
      <AuthForm action={login} submit="Sign in" fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]} />
    </main>
  );
}
