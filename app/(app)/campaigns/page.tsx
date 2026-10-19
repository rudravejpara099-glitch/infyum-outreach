import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listCampaigns } from "@/lib/db/repos/campaigns";
import { countByStage } from "@/lib/db/repos/leads";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_BADGE = { draft: "badge-muted", active: "badge-ok", paused: "badge-warn", done: "badge-muted" } as const;

export default async function CampaignsPage() {
  await requireUser();
  const db = getDb();
  const campaigns = listCampaigns(db);
  return (
    <>
      <PageHeader title="Campaigns" sub="One campaign is one audience, one message setup and one booking link."
        actions={<Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>} />
      {campaigns.length === 0 ? <Empty title="No campaigns yet">Create one to say who you want to reach.</Empty> : (
        <div className="card divide-y divide-line">
          {campaigns.map((c) => {
            const s = countByStage(db, c.id);
            const total = Object.values(s).reduce((a, b) => a + b, 0);
            return (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-bg">
                <div>
                  <div className="font-medium">{c.name} <span className={`badge ml-2 ${STATUS_BADGE[c.status]}`}>{c.status}</span></div>
                  <div className="mt-0.5 text-xs text-muted">{c.niches.join(", ") || "No niche chosen"} · {c.minFollowers.toLocaleString()} to {c.maxFollowers.toLocaleString()} followers · {c.country}</div>
                </div>
                <div className="text-right text-xs text-muted tabular-nums">{total} leads · {s.dm_sent ?? 0} sent · {(s.replied ?? 0) + (s.call_offered ?? 0)} replied · {s.booked ?? 0} booked</div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
