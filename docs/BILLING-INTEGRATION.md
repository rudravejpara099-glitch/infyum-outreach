# Billing integration contract (Codex → Claude)

Owner approved Q1–Q9 and the at-cost plan. This document is a request; Claude must ACK and implement his hooks before billed campaigns can run. No real AI/Apify calls or live payments are authorized.

Codex owns lib/billing and migration 2. Do not add migration 2 elsewhere. All persisted monetary values are safe integer USD micro-dollars. Canonical dates/month boundaries are UTC.

Planned public surface (exported from lib/billing/index.ts):

- `reserveUsage(db, { userId, operationId, provider: "ai" | "apify", maxCostMicros, source, now?, apifyMonthlyUsageMicros? })`: synchronous immediate SQLite transaction; checks consent/ceiling, confirmed commitments, overdue bills, existing reservations and global Apify cap. Returns durable reservation. Unknown rates/usage or missing bounded cost must not dispatch a provider call. `source` carries campaignId/accountId/leadId/jobId where known. Never infer the payer from the worker/email actor.
- `settleUsage(db, operationId, events)`: atomically writes exact usage events and settles the hold. Events contain a globally unique eventKey, userId, occurredAt, kind, quantity, unitCostMicros, unitQuantity, costMicros, providerRef and source. Only authoritative/confirmed costs; no estimates. Same event/operation may replay identically, conflicting replay is refused. Charged failures count; unknown outcomes keep their hold and must not blindly retry. Report an unexpected provider overrun and pause further paid work rather than hide the real cost.
- `recordUsage(db, event)`: idempotent append-only evidence entry (used for confirmed fixed-cost accrual; paid provider calls must use reservations). Usage kinds: apify, ai_input_tokens, ai_output_tokens, proxy_share, hosting_share. Split cache-input components into separate uniquely keyed input-token events using the actual cache rate. Input/output/token unit costs have unitQuantity 1,000,000; Apify costs have quantity 1/unitQuantity 1.
- `billingHold(db, userId, now?)`: returns a human-readable pause reason or null. `payerFor(db, "campaign" | "account", id)` returns an explicit consented payer or null. Campaign and sender account payers must agree. CLI/internal unassigned work is separate; it must never get billed or silently bypass a billed campaign's hold.
- `syncBilling(db, userId, now?)`: idempotent accrual of confirmed fixed costs and closed-month statements. Invoke before reservations and periodically via existing infrastructure. No new queue/service.

Paid API implementation belongs to Claude. Existing complete() returns only text: extend compatibly to carry billing context and exact resolved model/request ID, actual charged input/output/cache token counts and versioned rates. Meter all attempts including drafting retries, replies, follow-ups, and direct warm-up comment calls. No personal subscription fallback. Billing code provides token-cost helpers and versioned rate lookup; placeholder/unverified prices cannot authorize real billed calls.

Apify must return run IDs and authoritative per-run USD usage; monthly account usage is a global safety/reconciliation figure, never added again as a user's cost. Supply a verified current-month aggregate to preflight and a provider-side maximum run cost covering the reservation. Missing usage must fail closed rather than become zero. Existing global Settings cap and per-user ceiling both apply. Retain holds for unresolved provider runs after crashes.

UI starts for billed campaigns remain disabled until the integration marker is explicitly recorded after Claude's reviewed implementation. Neither an environment switch nor this document is proof that the hooks work. Migration 2 does not enable billing on old campaigns or assign users automatically.
