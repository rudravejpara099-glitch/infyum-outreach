// Lead search through Apify. It only reads public data: no Instagram login, no account risk.
// It is off until a monthly dollar limit is saved in Settings, and it stops before that limit is crossed.
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const DEFAULT_SEARCH_ACTOR = "apify~instagram-search-scraper";

export class ApifyOffError extends Error {}

export class ApifyClient {
  constructor(private readonly opts: { token: string; fetchImpl?: FetchLike }) {}
  private get f(): FetchLike { return this.opts.fetchImpl ?? (fetch as unknown as FetchLike); }

  /** Dollars used so far this month on the Apify account. */
  async monthlyUsageUsd(): Promise<number> {
    const res = await this.f(`https://api.apify.com/v2/users/me/limits?token=${this.opts.token}`);
    if (!res.ok) throw new Error(`Apify usage check failed (${res.status})`);
    const body = (await res.json()) as { data?: { current?: { monthlyUsageUsd?: number } } };
    return body.data?.current?.monthlyUsageUsd ?? 0;
  }

  async runActor(actor: string, input: Record<string, unknown>): Promise<unknown[]> {
    const res = await this.f(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${this.opts.token}&timeout=240`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Apify run failed (${res.status})`);
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  }
}

export type Candidate = { handle: string; followers: number | null; niche: string };

/** Different actor versions name fields differently, so accept the common spellings. */
export function toCandidate(item: unknown, niche: string): Candidate | null {
  const r = item as Record<string, unknown>;
  const raw = r.username ?? r.ownerUsername ?? r.handle;
  if (typeof raw !== "string" || !/^[A-Za-z0-9._]+$/.test(raw)) return null;
  const f = r.followersCount ?? r.followers_count ?? r.followers;
  return { handle: raw.toLowerCase(), followers: typeof f === "number" ? f : null, niche };
}

export async function searchLeads(
  client: Pick<ApifyClient, "monthlyUsageUsd" | "runActor">,
  opts: { capUsd: number | null; terms: string[]; perTerm: number; actor?: string; stopAtFraction?: number },
): Promise<Candidate[]> {
  if (opts.capUsd === null) throw new ApifyOffError("Lead search is off. Set a monthly limit in Settings.");
  const out = new Map<string, Candidate>();
  for (const term of opts.terms) {
    // Check before every run, so the limit holds even if one run costs more than expected.
    const used = await client.monthlyUsageUsd();
    if (used >= opts.capUsd * (opts.stopAtFraction ?? 0.9)) {
      if (out.size === 0) throw new ApifyOffError(`Monthly limit reached ($${used.toFixed(2)} of $${opts.capUsd}).`);
      break;
    }
    const items = await client.runActor(opts.actor ?? DEFAULT_SEARCH_ACTOR, { search: term, searchType: "user", searchLimit: opts.perTerm, resultsLimit: opts.perTerm });
    for (const item of items) {
      const c = toCandidate(item, term);
      if (c && !out.has(c.handle)) out.set(c.handle, c);
    }
  }
  return [...out.values()];
}
