import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listLeads } from "@/lib/db/repos/leads";
import { listCampaigns } from "@/lib/db/repos/campaigns";
import { STAGES } from "@/lib/domain/stages";
import { number } from "@/lib/format";
import { stageCopy } from "@/lib/ui/copy";
import { Empty, PageHeader } from "@/components/ui";
import { notFound } from "next/navigation";
import { z } from "zod";

export const dynamic = "force-dynamic";
const PER_COLUMN = 40;

export default async function Pipeline({ searchParams }: PageProps<"/pipeline">) {
  await requireUser();
  const sp = await searchParams;
  const rawCampaign = Array.isArray(sp.campaign) ? sp.campaign[0] : sp.campaign;
  const parsedCampaign = z.coerce.number().int().positive().safeParse(rawCampaign);
  if (rawCampaign !== undefined && rawCampaign !== "" && !parsedCampaign.success) notFound();
  const db = getDb();
  const campaigns = listCampaigns(db);
  const campaignId = parsedCampaign.success ? parsedCampaign.data : undefined;
  const selectedCampaign = campaignId ? campaigns.find((campaign) => campaign.id === campaignId) : undefined;
  if (campaignId && !selectedCampaign) notFound();
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
      {leads.length === 0 ? <Empty title={selectedCampaign ? "No leads in this campaign yet" : "No leads yet"}>
        <p>{selectedCampaign ? "Add Instagram handles in this campaign to see them move through the checks." : "Create a campaign and add leads to see their progress here."}</p>
        <Link href={selectedCampaign ? `/campaigns/${selectedCampaign.id}#add-leads` : "/campaigns/new"} className="mt-3 inline-block text-accent underline">
          {selectedCampaign ? "Add leads to this campaign" : "Create a campaign"}
        </Link>
      </Empty> : <div className="flex gap-3 overflow-x-auto pb-4">
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
                {items.length === 0 && <div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted">No leads here yet</div>}
              </div>
            </section>
          );
        })}
      </div>}
      <details id="skipped" className="mt-6">
        <summary className="cursor-pointer text-sm font-medium">Skipped ({skipped.length}) and why</summary>
        <ul className="card mt-3 divide-y divide-line">
          {skipped.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No skipped leads.</li> : skipped.map((l) => (
            <li key={l.id}><Link href={`/leads/${l.id}`} className="flex justify-between px-4 py-2 hover:bg-bg"><span>@{l.handle}</span><span className="text-muted">{l.skipReason || "No reason recorded"}</span></Link></li>
          ))}
        </ul>
      </details>
    </>
  );
}
