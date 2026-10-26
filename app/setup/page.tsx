import { redirect } from "next/navigation";
import { getIdentityDb } from "@/lib/workspaces/storage";
import { countUsers } from "@/lib/db/repos/users";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { setup } from "@/app/login/actions";

export const dynamic = "force-dynamic"; // reads the database on every request

export default function SetupPage() {
  if (countUsers(getIdentityDb()) > 0) redirect("/login");
  return (
    <AuthPanel title="Make room for better conversations" description="Create the first workspace account. You can invite your team from Workspaces.">
      <AuthForm action={setup} submit="Create account" fields={[
        { name: "name", label: "Your name", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
      ]} />
    </AuthPanel>
  );
}
