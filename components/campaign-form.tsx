"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Campaign, IgAccount } from "@/lib/db/types";
import { NICHE_OPTIONS } from "@/lib/campaign-form";
import { saveCampaign } from "@/app/(app)/campaigns/actions";

export function CampaignForm({ campaign, accounts, selected }: { campaign?: Campaign; accounts: IgAccount[]; selected: number[] }) {
  const custom = campaign?.niches.filter((n) => !(NICHE_OPTIONS as readonly string[]).includes(n)).join(", ") ?? "";
  const [feedback, run, pending] = useActionState(saveCampaign, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const value = (name: string, initial: string | number = "") => ({ value: values[name] ?? initial, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(previous => ({ ...previous, [name]: event.target.value })) });
  const checked = (name: string, initial: boolean) => ({ checked: checks[name] ?? initial, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setChecks(previous => ({ ...previous, [name]: event.target.checked })) });
  useEffect(() => {
    const field = feedback?.field ? formRef.current?.elements.namedItem(feedback.field) : null;
    if (!(field instanceof HTMLElement)) return;
    let parent = field.parentElement;
    while (parent && parent !== formRef.current) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    field.focus();
  }, [feedback]);
  return (
    <form ref={formRef} action={run} aria-busy={pending} className="flex max-w-2xl flex-col gap-6">
      {campaign && <input type="hidden" name="id" value={campaign.id} />}
      <div><label className="label" htmlFor="name">Campaign name</label><input id="name" name="name" required {...value("name", campaign?.name)} placeholder="e.g. Credit repair, US" className="input" /></div>

      <fieldset>
        <legend className="label">Which kind of audience?</legend>
        <div className="flex flex-wrap gap-2">
          {NICHE_OPTIONS.map((n) => (
            <label key={n} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="niches" value={n} {...checked(`niche-${n}`, campaign?.niches.includes(n) ?? false)} className="accent-[var(--accent)]" />{n}
            </label>
          ))}
        </div>
        <label className="label mt-3" htmlFor="nicheOther">Other audience types (optional)</label>
        <input id="nicheOther" name="nicheOther" {...value("nicheOther", custom)} placeholder="Other kinds, separated by commas" className="input mt-2" />
      </fieldset>

      <div><label className="label" htmlFor="audienceText">Describe the audience in your own words</label>
        <textarea id="audienceText" name="audienceText" rows={3} {...value("audienceText", campaign?.audienceText)} placeholder="US credit repair owners who run free consultations and post reels" className="input" /></div>

      <div className="form-columns grid grid-cols-3 gap-3">
        <div><label className="label" htmlFor="minFollowers">Minimum followers</label><input id="minFollowers" name="minFollowers" type="number" min={0} {...value("minFollowers", campaign?.minFollowers ?? 2000)} className="input" /></div>
        <div><label className="label" htmlFor="maxFollowers">Maximum followers</label><input id="maxFollowers" name="maxFollowers" type="number" min={1} {...value("maxFollowers", campaign?.maxFollowers ?? 150000)} className="input" /></div>
        <div><label className="label" htmlFor="country">Country to reach</label><input id="country" name="country" {...value("country", campaign?.country ?? "United States")} className="input" /></div>
      </div>

      <fieldset>
        <legend className="label">Instagram accounts that can send</legend>
        {accounts.length === 0 ? <p className="text-muted"><Link href="/accounts" className="text-accent underline">Add an Instagram account</Link> to send from. You can save this campaign first.</p> : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="checkbox" name="accountIds" value={a.id} {...checked(`account-${a.id}`, selected.includes(a.id))} className="accent-[var(--accent)]" />@{a.handle}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2"><input type="checkbox" name="approvalRequired" {...checked("approvalRequired", campaign?.approvalRequired ?? true)} className="mt-1 accent-[var(--accent)]" />
          <span><span className="font-medium">Review messages before sending</span><br /><span className="text-muted">Recommended. Sensitive topics, including price and contracts, always wait for your review even when this is off.</span></span></label>

      </div>

      <details className="form-section"><summary>Booking and follow-ups</summary><p className="mb-4 text-sm text-muted">Optional. Choose where people book a call and whether to follow up when they haven’t replied.</p>      <div><label className="label" htmlFor="bookingLink">Booking link for this campaign</label><input id="bookingLink" name="bookingLink" {...value("bookingLink", campaign?.bookingLink)} placeholder="https://calendly.com/…" className="input" /></div>        <label className="mt-4 flex items-start gap-2"><input type="checkbox" name="followupsEnabled" {...checked("followupsEnabled", campaign?.followupsEnabled ?? true)} className="mt-1 accent-[var(--accent)]" />
          <span><span className="font-medium">Send follow-ups</span><br /><span className="text-muted">Up to 2, days apart, only if they have not replied.</span></span></label></details>
      {feedback?.error && <p role="alert" className="text-bad">{feedback.error}</p>}
      <p className="text-sm text-muted">{campaign ? "Changes apply to this campaign when you save." : "Saving a campaign doesn’t start it. You can review the settings before choosing Start campaign."}</p>
      <div><button disabled={pending} className="btn btn-primary">{pending ? "Saving campaign…" : campaign ? "Save changes" : "Create campaign"}</button></div>
    </form>
  );
}
