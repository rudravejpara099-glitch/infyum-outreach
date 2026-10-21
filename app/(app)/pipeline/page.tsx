import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listLeads } from "@/lib/db/repos/leads";
import { listCampaigns } from "@/lib/db/repos/campaigns";
import { STAGES } from "@/lib/domain/stages";
import { number } from "@/lib/format";
import { stageCopy } from "@/lib/ui/copy";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
const PER_COLUMN = 40;

export default async function Pipeline({ searchParams }: PageProps<"/pipeline">) {
  await requireUser();
  const sp = await searchParams;
  const campaignId = Number(Array.isArray(sp.campaign) ? sp.campaign[0] : sp.campaign) || undefined;
  const db = getDb();
  const campaigns = listCampaigns(db);
  const leads = listLeads(db, { campaignId, limit: 2000 });
  const columns = STAGES.filter((s) => s !== "skipped");
  const skipped = leads.filter((l) => l.stage === "skipped");

  return (
    <>
      <PageHeader title="Lead progress" sub="See which checks and messages each lead has reached."
        actions={
          <form className="flex gap-2">
            <select name="campaign" defaultValue={campaignId ?? ""} className="input w-52" aria-label="Campaign">
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn">Filter</button>
          </form>} />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <section key={stage} id={stage} className="w-64 shrink-0">
              <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                <span title={stageCopy[stage].description}>{stageCopy[stage].label}</span><span className="tabular-nums">{items.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {items.slice(0, PER_COLUMN).map((l) => (
                  <Link key={l.id} href={`/leads/${l.id}`} className="card p-3 transition-colors hover:border-accent">
                    <div className="font-medium">@{l.handle}</div>
                    <div className="mt-0.5 text-xs text-muted">{number(l.followers)} followers{l.niche ? ` · ${l.niche}` : ""}</div>
                  </Link>
                ))}
                {items.length > PER_COLUMN && <p className="px-1 text-xs text-muted">+ {items.length - PER_COLUMN} more</p>}
                {items.length === 0 && <div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted">Empty</div>}
              </div>
            </section>
          );
        })}
      </div>
      <details id="skipped" className="mt-6">
        <summary className="cursor-pointer text-sm font-medium">Skipped ({skipped.length}) and why</summary>
        <ul className="card mt-3 divide-y divide-line">
          {skipped.map((l) => (
            <li key={l.id}><Link href={`/leads/${l.id}`} className="flex justify-between px-4 py-2 hover:bg-bg"><span>@{l.handle}</span><span className="text-muted">{l.skipReason || "No reason recorded"}</span></Link></li>
          ))}
        </ul>
      </details>
    </>
  );
}
