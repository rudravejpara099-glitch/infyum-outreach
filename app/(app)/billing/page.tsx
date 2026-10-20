import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { billingOverview } from "@/lib/billing/queries";
import { profile, billingConfig, integrationReady } from "@/lib/billing/config";
import { syncBilling } from "@/lib/billing/sync";
import { usd } from "@/lib/billing/money";
import { isOwner } from "@/lib/billing/rules";
import { statementState } from "@/lib/billing/statements";
import { PageHeader, Stat } from "@/components/ui";
import { BillingForm } from "@/components/billing-form";
import { changeSpendingLimit, claimBillingResource, refreshBilling } from "./actions";
export const dynamic = "force-dynamic";
export default async function BillingPage() {
  const user = await requireUser(); const db = getDb(); syncBilling(db, user.id);
  const data = billingOverview(db, user.id), p = profile(db, user.id), cfg = billingConfig(db), ready = integrationReady(db);
  const apify = (db.prepare("SELECT value FROM settings WHERE key='apify_monthly_cap_usd'").get() as { value: string } | undefined)?.value;
  const resources = db.prepare("SELECT 'campaign' kind,c.id,c.name label,b.user_id payer FROM campaigns c LEFT JOIN billing_assignments b ON b.resource_kind='campaign' AND b.resource_id=c.id UNION ALL SELECT 'account',a.id,'@'||a.handle,b.user_id FROM ig_accounts a LEFT JOIN billing_assignments b ON b.resource_kind='account' AND b.resource_id=a.id").all() as { kind: "campaign" | "account"; id: number; label: string; payer: number | null }[];
  const percent = data.snapshot.ceilingMicros ? Math.min(100, Number(BigInt(data.snapshot.projectedMicros) * 100n / BigInt(data.snapshot.ceilingMicros))) : 0;
  return <div className="billing-page">
    <PageHeader title="Usage and billing" sub="Your costs, clearly accounted for. USD · calendar months in UTC." actions={<><a href={`/billing/export?month=${data.period.start.slice(0, 7)}`} className="btn">Download usage</a>{isOwner(user.id, process.env.BILLING_OWNER_USER_ID) && <Link href="/billing/admin" className="btn">Billing administration</Link>}</>} />
    <section className="billing-notice"><span className="badge badge-warn">Test mode</span><div><strong>{cfg.markup_percent ? "Your usage costs and service margin are shown separately." : "We charge exactly what it costs us."}</strong><p>No real payment is taken. Planning estimates are never added to your usage.</p></div></section>
    <div className="billing-stats"><Stat label="Recorded this month" value={usd(data.current.subtotalMicros)} hint="Actual recorded costs before payment fees" /><Stat label="Today" value={usd(data.todayMicros)} hint="Recorded costs in UTC" /><Stat label="Month-end projection" value={data.projectionMicros === null ? "—" : usd(data.projectionMicros)} hint="Based on recorded usage, before payment fees; not a bill" /><Stat label="Unpaid statements" value={usd(data.unpaidMicros)} hint="Finalized statements only" /></div>
    <div className="billing-columns">
      <section className="card p-5"><h2>This month so far</h2><p className="mt-1 text-sm text-muted">{data.period.start} to {data.period.end} · costs appear after confirmed usage.</p>
        <dl className="billing-breakdown">{[{ label: "AI writing", value: data.current.items.filter(i => i.kind.startsWith("ai_")).reduce((n, i) => n + i.costMicros, 0) }, { label: "Lead search", value: data.current.items.find(i => i.kind === "apify")?.costMicros ?? 0 }, { label: "Instagram network", value: data.current.items.find(i => i.kind === "proxy_share")?.costMicros ?? 0 }, { label: "Hosting", value: data.current.items.find(i => i.kind === "hosting_share")?.costMicros ?? 0 }, ...(data.current.markupMicros ? [{ label: "Service margin", value: data.current.markupMicros }] : []), { label: "Payment fee · estimate", value: data.current.feeMicros }].map(item => <div key={item.label}><dt>{item.label}</dt><dd title={usd(item.value, 6)}>{usd(item.value)}</dd></div>)}</dl>
        {!data.events.length && <p className="billing-empty">No recorded usage yet. Set your limit and assign resources to begin once the metered worker is connected.</p>}
        <p className="text-xs text-muted">Actual payment fees are reconciled on the next statement. Tiny balances carry forward; no minimum usage charge is added.</p>
        {data.pendingFees > 0 && <p className="mt-3 text-sm text-warn">{data.pendingFees} payment fee reconciliation{data.pendingFees === 1 ? " is" : "s are"} waiting for provider data.</p>}
      </section>
      <section className="card p-5"><h2>Your spending limit</h2><p className="mt-1 text-sm text-muted">Includes paid work, committed expenses and estimated payment fees.</p>
        <div className="billing-meter" role="progressbar" aria-label="Monthly spending limit used or reserved" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
        <p className="text-sm">{usd(data.snapshot.projectedMicros)} used or reserved of {usd(data.snapshot.ceilingMicros)}</p>
        <p className="mt-2 text-xs text-muted">Open task reservations: {usd(data.snapshot.heldMicros)}. Upcoming confirmed expenses: {usd(data.snapshot.commitmentsMicros)}.</p>
        {data.hold && <p className="billing-hold">{data.hold}</p>}
        <BillingForm action={changeSpendingLimit}><label className="label" htmlFor="ceiling">Monthly spending ceiling (USD)</label><input className="input" id="ceiling" name="ceiling" type="number" min="0" step="0.01" max="1000000" required defaultValue={p ? usd(p.ceiling_micros).replace("$", "") : "0"} /><label className="billing-check"><input name="consent" type="checkbox" required defaultChecked={!!p?.consented_at} /><span>I accept responsibility for usage and confirmed expenses assigned to me. Paid work pauses at 90%; 0 switches paid work off.</span></label><button className="btn btn-primary">Save spending limit</button></BillingForm>
      </section>
    </div>
    <section className="card p-5"><div className="billing-section-heading"><div><h2>Past statements</h2><p className="mt-1 text-sm text-muted">Review the exact total before opening test checkout. Payment is due seven days after a statement is issued.</p></div><BillingForm action={refreshBilling}><button className="btn">Refresh usage</button></BillingForm></div>
      {!data.statements.length ? <p className="billing-empty">Your first statement appears after the month ends. No payment is due yet.</p> : <ul className="billing-list">{data.statements.map(row => <li key={row.id}><Link href={`/billing/statements/${row.id}`}><span>{row.period_start.slice(0, 7)}<small>{statementState(db, row)}</small></span><strong>{usd(row.total_cents * 10000)}</strong><span aria-hidden="true">→</span></Link></li>)}</ul>}
    </section>
    <details className="card p-5"><summary className="font-semibold">Resources you pay for</summary><p className="my-3 text-sm text-muted">Assign each campaign and Instagram account explicitly. Past activity is never charged. A resource can have only one payer.</p>{!ready && <p className="mb-3 text-sm text-warn">Assignments and paid starts are paused until the worker’s billing integration is reviewed.</p>}
      {!resources.length ? <p className="text-muted">Add a campaign and Instagram account first.</p> : <div className="billing-resource-grid">{resources.filter(r => !r.payer || r.payer === user.id).map(resource => <div key={`${resource.kind}-${resource.id}`} className="billing-resource"><strong>{resource.label}</strong><p className="text-xs text-muted">{resource.kind === "campaign" ? "Campaign" : "Instagram account"}{resource.payer ? " · assigned to you" : " · no payer assigned"}</p>{!resource.payer && <BillingForm action={claimBillingResource}><input type="hidden" name="kind" value={resource.kind} /><input type="hidden" name="resourceId" value={resource.id} /><label className="billing-check"><input type="checkbox" name="consent" required /><span>I will pay its recorded costs.</span></label><button className="btn" disabled={!ready || !p?.consented_at}>Assign to me</button></BillingForm>}</div>)}</div>}
    </details>
    <section className="billing-footnote"><h2>Lead search limit</h2><p>The shared Apify limit is {apify !== undefined && apify !== "" ? `$${apify} per month` : "not set; searches are off"}. This remains an additional limit alongside your personal ceiling. <Link href="/settings" className="text-accent underline">Open Settings</Link>.</p><p>Hosting is $0 while the app runs on the owner’s Mac. Network and hosted-worker costs appear only after actual expenses are confirmed.</p></section>
  </div>;
}
