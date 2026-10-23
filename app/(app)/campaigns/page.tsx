import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listCampaigns } from "@/lib/db/repos/campaigns";
import { countByStage } from "@/lib/db/repos/leads";
import { Empty, PageHeader } from "@/components/ui";
import { CAMPAIGN_STATUS_LABEL } from "@/components/campaign-status";
import { ActionForm } from "@/components/action-form";
import { changeCampaignStatus } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_BADGE = { draft: "badge-muted", active: "badge-ok", paused: "badge-warn", done: "badge-muted" } as const;

export default async function CampaignsPage() {
  await requireUser();
  const db = getDb();
  const campaigns = listCampaigns(db);
  return (
    <>
      <PageHeader title="Campaigns" sub="Each campaign has its own audience, message settings and sending accounts."
        actions={<Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>} />
      {campaigns.length === 0 ? <Empty title="No campaigns yet">Create one to say who you want to reach.</Empty> : (
        <div className="card divide-y divide-line">
          {campaigns.map((c) => {
            const s = countByStage(db, c.id);
            const total = Object.values(s).reduce((a, b) => a + b, 0);
            return (
              <div key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <Link href={`/campaigns/${c.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-md hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <div className="min-w-0">
                    <div className="font-medium">{c.name} <span className={`badge ml-2 ${STATUS_BADGE[c.status]}`}>{CAMPAIGN_STATUS_LABEL[c.status]}</span></div>
                    <div className="mt-0.5 text-xs text-muted">{c.niches.join(", ") || "No niche chosen"} · {c.minFollowers.toLocaleString()} to {c.maxFollowers.toLocaleString()} followers · {c.country}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted tabular-nums">{total} leads · {s.dm_sent ?? 0} sent · {s.replied ?? 0} replied</div>
                </Link>
                {c.status === "active" && <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <ActionForm action={changeCampaignStatus} className="contents">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="paused" />
                    <button className="btn" aria-label={`Pause ${c.name}`}>Pause</button>
                  </ActionForm>
                  <ActionForm action={changeCampaignStatus} className="contents" confirmMessage={`Stop “${c.name}”? No new work will run. A message already being sent may still complete; saved drafts will remain.`}>
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="done" />
                    <button className="btn" aria-label={`Stop ${c.name}`}>Stop</button>
                  </ActionForm>
                </div>}
                {c.status === "paused" && <div className="sm:shrink-0"><ActionForm action={changeCampaignStatus} className="contents">
                  <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="active" />
                  <button className="btn" aria-label={`Resume ${c.name}`}>Resume</button>
                </ActionForm></div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
