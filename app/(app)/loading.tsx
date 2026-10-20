import { requireUser } from "@/lib/auth/dal";

export default async function WorkspaceLoading() {
  await requireUser();
  return <div className="card p-6" role="status"><h2>Opening your workspace…</h2><p className="mt-2 text-muted">Your campaign details are on their way.</p></div>;
}
