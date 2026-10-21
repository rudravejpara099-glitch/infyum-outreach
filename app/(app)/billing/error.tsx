"use client";
export default function BillingError({ retry }: { retry: () => void }) { return <section className="card p-5" role="alert"><h1>Billing couldn’t load</h1><p className="my-3 text-muted">No payment was taken by loading this page. Try again, or ask the workspace owner to check the billing connection.</p><button className="btn" onClick={retry}>Try again</button></section>; }
