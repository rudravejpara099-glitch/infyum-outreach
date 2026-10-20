import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { login } from "./actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default function LoginPage() {
  if (countUsers(getDb()) === 0) redirect("/setup");
  return (
    <AuthPanel title="Welcome back" description="Sign in to continue your conversations.">
      <AuthForm action={login} submit="Sign in" fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]} />
    </AuthPanel>
  );
}
