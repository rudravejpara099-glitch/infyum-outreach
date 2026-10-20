import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { campaignAccountIds, getCampaign } from "@/lib/db/repos/campaigns";
import { listAccounts } from "@/lib/db/repos/accounts";
import { countByStage, listLeads } from "@/lib/db/repos/leads";
import { STAGE_LABEL } from "@/lib/domain/stages";
import { number, STAGE_BADGE } from "@/lib/format";
import { CampaignForm } from "@/components/campaign-form";
import { PageHeader } from "@/components/ui";
import { getSetting } from "@/lib/db/repos/settings";
import { addLeads, changeCampaignStatus, findLeads } from "../actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await params;
  const db = getDb();
  const campaign = getCampaign(db, Number(id));
  if (!campaign) notFound();
  const counts = countByStage(db, campaign.id);
  const leads = listLeads(db, { campaignId: campaign.id, limit: 12 });
  const searchOn = getSetting(db, "apify_monthly_cap_usd") !== null && getSetting(db, "apify_monthly_cap_usd") !== "";
  const next = campaign.status === "active" ? { to: "paused", label: "Pause campaign" } : { to: "active", label: campaign.status === "draft" ? "Start campaign" : "Resume campaign" };

  return (
    <>
      <PageHeader title={campaign.name} sub={`Status: ${campaign.status}`}
        actions={<form action={changeCampaignStatus}><input type="hidden" name="id" value={campaign.id} /><input type="hidden" name="status" value={next.to} /><button className="btn btn-primary">{next.label}</button></form>} />

      <div className="mb-8 flex flex-wrap gap-2">
        {Object.entries(counts).map(([stage, n]) => (
          <Link key={stage} href={`/pipeline?campaign=${campaign.id}`} className={`badge ${STAGE_BADGE[stage as keyof typeof STAGE_BADGE]}`}>{STAGE_LABEL[stage as keyof typeof STAGE_LABEL]} {n}</Link>
        ))}
      </div>

      <div className="grid gap-10 xl:grid-cols-[1fr_24rem]">
        <section><h2 className="mb-3 text-base font-semibold">Settings</h2>
          <CampaignForm campaign={campaign} accounts={listAccounts(db)} selected={campaignAccountIds(db, campaign.id)} /></section>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="mb-1 text-base font-semibold">Add leads</h2>
            <p className="mb-2 text-xs text-muted">Paste Instagram handles, one per line. Anyone already in the app or on the do-not-contact list is skipped.</p>
            <form action={addLeads} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={campaign.id} />
              <textarea name="handles" rows={5} placeholder={"@handle1\n@handle2"} className="input" aria-label="Handles" />
              <button className="btn">Add to campaign</button>
            </form>
            <form action={findLeads} className="mt-4">
              <input type="hidden" name="id" value={campaign.id} />
              <button className="btn" disabled={!searchOn}>Find leads automatically</button>
              <p className="mt-2 text-xs text-muted">{searchOn ? "Searches Apify for this campaign's niches. New leads appear below within a few minutes." : "Off. Set a monthly limit in Settings and start the worker with APIFY_TOKEN."}</p>
            </form>
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold">Latest leads</h2>
            {leads.length === 0 ? <p className="text-muted">None yet.</p> : (
              <ul className="card divide-y divide-line">
                {leads.map((l) => (
                  <li key={l.id}><Link href={`/leads/${l.id}`} className="flex items-center justify-between px-3 py-2 hover:bg-bg">
                    <span>@{l.handle} <span className="text-xs text-muted">{number(l.followers)}</span></span>
                    <span className={`badge ${STAGE_BADGE[l.stage]}`}>{STAGE_LABEL[l.stage]}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
