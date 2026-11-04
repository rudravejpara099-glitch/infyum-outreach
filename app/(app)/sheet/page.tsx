import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listLeads } from "@/lib/db/repos/leads";
import { sheetsStatus } from "@/lib/sheets/connection";
import { TABS, leadExtras, leadRow, safeCell, normUsername, SHEET_SETTING_KEYS, type Cell } from "@/lib/sheets/model";
import { getSetting } from "@/lib/db/repos/settings";
import { PageHeader } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const dynamic = "force-dynamic";

/** The same tabs and rows the Google Sheet receives, shown inside the app. */
export default async function SheetView({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser();
  const db = await getDb();
  const wanted = (await searchParams).tab;
  const tab = TABS.find((t) => t.name === wanted) ?? TABS[0];
  const status = sheetsStatus(db);
  let rows: Cell[][] = [];
  if (tab.name === "Leads") rows = listLeads(db, { limit: 2000 }).map((l) => leadRow(l, leadExtras(db, l.id)));
  else if (tab.name === "Jobs") rows = (db.prepare("SELECT j.id, j.type, l.handle, j.status, j.run_after, j.attempts, j.last_error, j.created_at FROM jobs j LEFT JOIN leads l ON l.id=j.lead_id ORDER BY j.id DESC LIMIT 500").all() as Record<string, string | number | null>[]).map((r) => [r.id as number, r.type as string, safeCell(r.handle ? normUsername(String(r.handle)) : ""), r.status as string, safeCell(r.run_after as string), r.attempts as number, safeCell(r.last_error as string), safeCell(r.created_at as string)]);
  else if (tab.name === "Activity Log") rows = (db.prepare("SELECT a.id, a.ts, a.actor, a.action, l.handle, a.detail FROM activity a LEFT JOIN leads l ON l.id=a.lead_id ORDER BY a.id DESC LIMIT 500").all() as Record<string, string | number | null>[]).map((r) => [r.id as number, safeCell(r.ts as string), safeCell(r.actor as string), safeCell(r.action as string), safeCell(r.handle ? normUsername(String(r.handle)) : ""), safeCell(r.detail as string)]);
  else if (tab.name === "Do-not-contact") rows = (db.prepare("SELECT * FROM do_not_contact").all() as Record<string, string | null>[]).map((r) => [safeCell(r.handle), safeCell(r.reason), safeCell(r.added_at ?? r.created_at)]);
  else rows = SHEET_SETTING_KEYS.map((k) => [k, safeCell(getSetting(db, k) ?? "")]);
  return (
    <>
      <LiveRefresh />
      <PageHeader title="Sheet" sub="Live view of the team's Sheet: same tabs and rows, updating every few seconds."
        actions={status.sheetId ? <a className="btn" href={`https://docs.google.com/spreadsheets/d/${status.sheetId}`} target="_blank" rel="noreferrer">Open in Google Sheets</a> : <Link className="btn" href="/settings">Connect Google Sheet</Link>} />
      <p className="mb-3 text-sm text-muted">{status.connected ? `Google Sheet connected${status.syncedAt ? `, last synced ${status.syncedAt}` : ""}.` : "Google Sheet is not connected yet, so this view comes straight from the app. Connect it in Settings and the same rows appear in Google."}</p>
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Sheet tabs">
        {TABS.map((t) => <Link key={t.name} href={`/sheet?tab=${encodeURIComponent(t.name)}`} className={t.name === tab.name ? "btn btn-primary" : "btn"}>{t.name}</Link>)}
      </nav>
      {status.sheetId && <iframe title="Google Sheet" className="card mb-4 h-[70vh] w-full" src={`https://docs.google.com/spreadsheets/d/${status.sheetId}/edit?rm=minimal`} />}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line"><tr>{tab.headers.map((h) => <th key={h} className="th whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? <tr><td className="td text-muted" colSpan={tab.headers.length}>No rows yet.</td></tr> : rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="td max-w-xs truncate" title={String(c)}>{String(c)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
