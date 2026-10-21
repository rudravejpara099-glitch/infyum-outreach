import { ActionForm } from "./action-form";
import type { Campaign, IgAccount } from "@/lib/db/types";
import { NICHE_OPTIONS } from "@/lib/campaign-form";
import { saveCampaign } from "@/app/(app)/campaigns/actions";

export function CampaignForm({ campaign, accounts, selected }: { campaign?: Campaign; accounts: IgAccount[]; selected: number[] }) {
  const custom = campaign?.niches.filter((n) => !(NICHE_OPTIONS as readonly string[]).includes(n)).join(", ") ?? "";
  return (
    <ActionForm action={saveCampaign} className="flex max-w-2xl flex-col gap-6">
      {campaign && <input type="hidden" name="id" value={campaign.id} />}
      <div><label className="label" htmlFor="name">Campaign name</label><input id="name" name="name" required defaultValue={campaign?.name} placeholder="e.g. Credit repair, US" className="input" /></div>

      <fieldset>
        <legend className="label">Which kind of audience?</legend>
        <div className="flex flex-wrap gap-2">
          {NICHE_OPTIONS.map((n) => (
            <label key={n} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="niches" value={n} defaultChecked={campaign?.niches.includes(n)} className="accent-[var(--accent)]" />{n}
            </label>
          ))}
        </div>
        <input name="nicheOther" defaultValue={custom} placeholder="Other kinds, separated by commas" className="input mt-2" aria-label="Other kinds of audience" />
      </fieldset>

      <div><label className="label" htmlFor="audienceText">Describe the audience in your own words</label>
        <textarea id="audienceText" name="audienceText" rows={3} defaultValue={campaign?.audienceText} placeholder="US credit repair owners who run free consultations and post reels" className="input" /></div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="minFollowers">Min followers</label><input id="minFollowers" name="minFollowers" type="number" min={0} defaultValue={campaign?.minFollowers ?? 2000} className="input" /></div>
        <div><label className="label" htmlFor="maxFollowers">Max followers</label><input id="maxFollowers" name="maxFollowers" type="number" min={1} defaultValue={campaign?.maxFollowers ?? 150000} className="input" /></div>
        <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" defaultValue={campaign?.country ?? "United States"} className="input" /></div>
      </div>

      <fieldset>
        <legend className="label">Instagram accounts that can send</legend>
        {accounts.length === 0 ? <p className="text-muted">Connect an account first on the Accounts page.</p> : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="checkbox" name="accountIds" value={a.id} defaultChecked={selected.includes(a.id)} className="accent-[var(--accent)]" />@{a.handle}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2"><input type="checkbox" name="approvalRequired" defaultChecked={campaign?.approvalRequired ?? true} className="mt-1 accent-[var(--accent)]" />
          <span><span className="font-medium">Ask me before anything is sent</span><br /><span className="text-muted">Review each first DM and follow-up before it is queued. Outreach stops at the first real reply.</span></span></label>
        <label className="flex items-start gap-2"><input type="checkbox" name="followupsEnabled" defaultChecked={campaign?.followupsEnabled ?? true} className="mt-1 accent-[var(--accent)]" />
          <span><span className="font-medium">Send follow-ups</span><br /><span className="text-muted">Up to 2, days apart, only if they have not replied.</span></span></label>
      </div>

      <div><button className="btn btn-primary">{campaign ? "Save changes" : "Create campaign"}</button></div>
    </ActionForm>
  );
}
