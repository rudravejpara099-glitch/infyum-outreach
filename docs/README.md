# Docs index

Every document, and whether you can trust it as current. If a doc is not listed here, treat it as unreviewed.

## Current (keep these true)
| Doc | What it is |
|---|---|
| [`STATUS.md`](STATUS.md) | What is true right now: checks, scope, known gaps, open decisions. Edit in place. |
| [`architecture.md`](architecture.md) | Where things live in the Phase 2 app. |
| [`DESIGN.md`](DESIGN.md) | How the app must look and behave. Read before any screen change. |
| [`PHASE-1-LOCK.md`](PHASE-1-LOCK.md) | The locked rules from the hand runs that the kit was built from. |
| [`APP-SETUP.md`](APP-SETUP.md) | Setting up and running the Phase 2 app. |
| [`BUILD-SLABS.md`](BUILD-SLABS.md) | The work order and status per slab. |
| [`BILLING.md`](BILLING.md), [`BILLING-INTEGRATION.md`](BILLING-INTEGRATION.md) | At-cost billing design and integration (Stripe test mode only). |
| [`decisions/`](decisions/) | Short notes on why the repo is the way it is. |
| [`skills/`](skills/) | Skills agents use: grilling (settle decisions), HIG checklists (UI). |

## Reference (dated snapshots, may be partly stale)
| Doc | What it is |
|---|---|
| [`BUILD-PLAN-AUDIT.md`](BUILD-PLAN-AUDIT.md) | Original line-by-line gap list against the build plan. |
| [`FUNCTIONAL-AUDIT.md`](FUNCTIONAL-AUDIT.md) | A running audit log from October. Historical. |
| [`UI-REVIEW.md`](UI-REVIEW.md) | A UI review pass. |
| [`patches/`](patches/) | A saved patch. Not applied automatically. |

## Archive (frozen history, never instructions)
| Doc | What it is |
|---|---|
| [`archive/HANDOFF.md`](archive/HANDOFF.md) | The old handoff log. Predates the "stop after first DM" scope. |
| [`archive/COLLAB.md`](archive/COLLAB.md) | The old Claude/Codex message board. Replaced by pull requests and CI. |

## Rules for docs
- A doc describes the present. Change it in place; do not append dated entries.
- Add a new doc to this index in the same pull request, or do not add it.
- A decision that matters and might be questioned later goes in `docs/decisions/` as a short note (what, why, date).
