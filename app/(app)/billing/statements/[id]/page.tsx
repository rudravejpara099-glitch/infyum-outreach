import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getStatement, breakdown, statementState, isPaid } from "@/lib/billing/statements";
import { usd } from "@/lib/billing/money";
import { isOwner } from "@/lib/billing/rules";
import { paymentConfigured } from "@/lib/billing/provider";
import { PageHeader } from "@/components/ui";
import { BillingForm } from "@/components/billing-form";
import { payStatement } from "../../actions";
export const dynamic = "force-dynamic";
export default async function StatementPage({ params }: PageProps<"/billing/statements/[id]">) {
  const user = await requireUser(); const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const db = getDb(), row = getStatement(db, Number(id));
  if (!row || (row.user_id !== user.id && !isOwner(user.id, process.env.BILLING_OWNER_USER_ID))) notFound();
  const data = breakdown(row), paid = isPaid(db, row.id), state = statementState(db, row);
  const due = new Date(Date.parse(row.created_at) + 7 * 86400000).toISOString().slice(0, 10);
  const receipt = db.prepare("SELECT p.id,r.actual_fee_micros FROM billing_payments p LEFT JOIN billing_fee_reconciliations r ON r.payment_id=p.id WHERE p.statement_id=?").get(row.id) as { id: number; actual_fee_micros: number | null } | undefined;
  return <div className="billing-page"><Link href="/billing" className="back-link">← Usage and billing</Link><PageHeader title={`Statement · ${row.period_start.slice(0, 7)}`} sub={`${row.period_start} to ${row.period_end} · issued ${row.created_at.slice(0, 10)} · USD · UTC`} actions={<a className="btn" href={`/billing/statements/${row.id}/export`}>Download statement</a>} />
    <section className="billing-notice"><span className="badge badge-warn">Test mode</span><p>No real payment. Returning from checkout does not mark a statement paid; verified provider confirmation does.</p></section>
    <section className="card p-5 billing-statement"><div className="billing-section-heading"><h2>Your exact statement</h2><span className={`badge ${paid ? "badge-ok" : "badge-warn"}`}>{state}</span></div>
      <dl className="billing-breakdown">{data.items.map(item => <div key={item.kind}><dt>{item.label}</dt><dd title={usd(item.costMicros, 6)}>{usd(item.costMicros)}</dd></div>)}<div><dt>Usage subtotal</dt><dd>{usd(data.subtotalMicros)}</dd></div>{data.previousCarryMicros !== 0 && <div><dt>Previous balance / rounding credit</dt><dd>{usd(data.previousCarryMicros, 6)}</dd></div>}{data.adjustmentMicros !== 0 && <div><dt>Actual payment-fee adjustment</dt><dd>{usd(data.adjustmentMicros, 6)}</dd></div>}<div><dt>Processor fee · estimated until settled</dt><dd>{usd(data.feeMicros)}</dd></div><div className="billing-total"><dt>Total {paid ? "paid" : "to pay"}</dt><dd>{usd(row.total_cents * 10000)}</dd></div>{row.carry_micros !== 0 && <div><dt>Carried to your next statement</dt><dd>{usd(row.carry_micros, 6)}</dd></div>}</dl>
      {row.total_cents > 0 ? <p className="text-sm text-muted">Payment due {due}. Checkout can charge only the total shown above. After the seven-day grace period, campaign starts and new paid work pause until payment is verified.</p> : <p className="text-sm text-muted">No payment is due. Small balances and credits carry forward without a penalty or minimum usage charge.</p>}
      {receipt && <p className="mt-3 text-sm text-muted">{receipt.actual_fee_micros === null ? "Payment verified; the actual processor fee is awaiting reconciliation." : `Actual processor fee: ${usd(receipt.actual_fee_micros)}. Any difference is included as a disclosed adjustment on the next statement.`}</p>}
      {!paid && row.total_cents > 0 && user.id === row.user_id && <BillingForm action={payStatement}><input type="hidden" name="statementId" value={row.id} /><button className="btn btn-primary" disabled={!paymentConfigured()}>Pay {usd(row.total_cents * 10000)} in test checkout</button>{!paymentConfigured() && <p className="text-sm text-muted">Test checkout is not connected yet. The owner must configure Stripe test credentials privately.</p>}</BillingForm>}
    </section></div>;
}
