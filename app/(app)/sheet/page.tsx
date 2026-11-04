import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { getSetting } from "@/lib/db/repos/settings";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The team's real Google Sheet, shown inside the app (editable here, same file as in Google Sheets). */
export default async function SheetView() {
  await requireUser();
  const db = await getDb();
  const sheetId = getSetting(db, "sheet_id");
  return (
    <>
      <PageHeader title="Sheet" sub="The team's Google Sheet, live inside the app."
        actions={sheetId ? <a className="btn" href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`} target="_blank" rel="noreferrer">Open in a new tab</a> : undefined} />
      {sheetId
        ? <iframe title="Google Sheet" className="card w-full" style={{ height: "calc(100vh - 11rem)", minHeight: 480 }} src={`https://docs.google.com/spreadsheets/d/${sheetId}/edit?rm=embedded`} />
        : <section className="card p-6"><h2 className="text-lg font-semibold">No Google Sheet connected</h2><p className="mt-1 text-muted">Choose the Sheet in Settings and it appears here.</p><Link href="/settings" className="mt-3 inline-block text-accent underline">Open Settings</Link></section>}
    </>
  );
}
