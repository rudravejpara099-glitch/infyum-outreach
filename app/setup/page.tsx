import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { setup } from "@/app/login/actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default function SetupPage() {
  if (countUsers(getDb()) > 0) redirect("/login");
  return (
    <AuthPanel title="Make room for better conversations" description="Create the first account. You can add teammates later in Settings.">
      <AuthForm action={setup} submit="Create account" fields={[
        { name: "name", label: "Your name", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
      ]} />
    </AuthPanel>
  );
}
