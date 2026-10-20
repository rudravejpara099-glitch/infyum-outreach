import { FeedbackForm } from "@/components/feedback-form";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { listDnc } from "@/lib/db/repos/dnc";
import { getSetting } from "@/lib/db/repos/settings";
import { PageHeader } from "@/components/ui";
import { addTeammate, blockHandle, saveApifyCap, unblockHandle } from "./actions";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const me = await requireUser();
  const db = getDb();
  const dnc = listDnc(db);
  const users = db.prepare("SELECT name, email FROM users ORDER BY id").all() as { name: string; email: string }[];
  const cap = getSetting(db, "apify_monthly_cap_usd");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-5">
          <h2 className="text-base font-semibold">Lead search budget</h2>
          <p className="mb-3 mt-1 text-muted">{cap ? `Monthly limit: $${cap}. The app stops searching before it goes over.` : "Switched off. Set a monthly budget in dollars to allow searches. Use 0 to stay on the free plan."}</p>
          <FeedbackForm action={saveApifyCap} className="flex flex-wrap items-end gap-2">
            <div className="w-40"><label className="label" htmlFor="cap">Monthly budget (USD)</label><input id="cap" name="cap" type="number" min={0} step="1" defaultValue={cap ?? ""} className="input" /></div>
            <button className="btn">Save budget</button>
          </FeedbackForm>
          <p className="mt-2 text-xs text-muted">Leave the budget blank to switch search off.</p><details className="mt-3 text-sm text-muted"><summary className="cursor-pointer">Connection help</summary><p className="mt-2">Search uses Apify. A saved budget permits searches, but the Apify connection and automatic assistant must also be set up on this computer. Ask the person who set up this workspace if searches don’t begin.</p></details>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Do not contact</h2><p className="mt-1 text-muted">Handles on this list won’t receive outreach from any campaign.</p>
          <FeedbackForm action={blockHandle} className="my-3 flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="blocked-handle">Instagram handle</label><input id="blocked-handle" name="handle" required placeholder="@handle" className="input" /></div>
            <div><label className="label" htmlFor="blocked-reason">Reason (optional)</label><input id="blocked-reason" name="reason" className="input" /></div>
            <button className="btn">Add to list</button>
          </FeedbackForm>
          {dnc.length === 0 ? <p className="text-muted">No handles on this list.</p> : (
            <ul className="divide-y divide-line">
              {dnc.map((d) => (
                <li key={d.handle} className="flex items-center justify-between py-2"><span>@{d.handle} <span className="text-muted">{d.reason}</span></span>
                  <FeedbackForm action={unblockHandle}><input type="hidden" name="handle" value={d.handle} /><button className="btn">Remove</button></FeedbackForm></li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold">Team</h2>
          <ul className="my-3 divide-y divide-line">{users.map((u) => <li key={u.email} className="py-2">{u.name} <span className="text-muted">{u.email}{u.email === me.email ? " (you)" : ""}</span></li>)}</ul>
          <FeedbackForm action={addTeammate} className="form-columns grid grid-cols-3 gap-2">
            <div><label className="label" htmlFor="teammate-name">Name</label><input id="teammate-name" name="name" type="text" required autoComplete="name" className="input" /></div>
            <div><label className="label" htmlFor="teammate-email">Email</label><input id="teammate-email" name="email" type="email" required autoComplete="email" className="input" /></div>
            <div><label className="label" htmlFor="teammate-password">Password</label><input id="teammate-password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" /></div>
            <p className="col-span-3 text-sm text-muted">Use at least 8 characters for the password. Share it privately with your teammate.</p><button className="btn col-span-3 w-fit">Add teammate</button>
          </FeedbackForm>
        </section>
      </div>
    </>
  );
}
