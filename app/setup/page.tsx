import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { setup } from "@/app/login/actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default function SetupPage() {
  if (countUsers(getDb()) > 0) redirect("/login");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p className="mt-1 text-muted">Create the first account. You can add teammates later in Settings.</p>
      </div>
      <AuthForm action={setup} submit="Create account" fields={[
        { name: "name", label: "Your name", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
      ]} />
    </main>
  );
}
