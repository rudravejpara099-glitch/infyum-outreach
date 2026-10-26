import { requireUser } from "@/lib/auth/dal";
export default async function LoadingBilling() { await requireUser(); return <section aria-busy="true" aria-live="polite"><h1>Usage and billing</h1><p className="mt-3 text-muted">Loading your recorded costs and statements…</p></section>; }
