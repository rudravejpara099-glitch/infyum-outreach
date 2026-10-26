// Lead search is read-only, but each actor run is paid and must be bounded and metered.
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const DEFAULT_SEARCH_ACTOR = "apify~instagram-search-scraper";
export const MAX_APIFY_RUN_MICROS = 250_000;

export class ApifyOffError extends Error {}
export class ApifyUsageUncertainError extends Error {}

export type ApifyUsageSnapshot = { monthlyUsageMicros: number; observedAt: string; cycleStartAt: string };
export type ApifyRun = { id: string; status: string; datasetId: string; usageTotalUsd: number | null; finishedAt: string | null };
export type ApifySearchClient = Pick<ApifyClient, "monthlyUsageSnapshot" | "startActorRun" | "getActorRun" | "getDatasetItems">;

function micros(usd: unknown): number {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0 || !Number.isSafeInteger(Math.round(usd * 1_000_000))) {
    throw new ApifyUsageUncertainError("Apify did not return a valid USD amount.");
  }
  return Math.round(usd * 1_000_000);
}

function runInfo(value: unknown): ApifyRun {
  const data = (value as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data.id !== "string" || typeof data.status !== "string" || typeof data.defaultDatasetId !== "string") {
    throw new ApifyUsageUncertainError("Apify returned incomplete run details. The reservation stays held.");
  }
  const usageTotalUsd = data.usageTotalUsd;
  if (usageTotalUsd !== null && (typeof usageTotalUsd !== "number" || !Number.isFinite(usageTotalUsd) || usageTotalUsd < 0)) {
    throw new ApifyUsageUncertainError("Apify returned invalid run usage. The reservation stays held.");
  }
  return { id: data.id, status: data.status, datasetId: data.defaultDatasetId, usageTotalUsd: usageTotalUsd as number | null, finishedAt: typeof data.finishedAt === "string" ? data.finishedAt : null };
}

export class ApifyClient {
  constructor(private readonly opts: { token: string; fetchImpl?: FetchLike }) {}
  private get f(): FetchLike { return this.opts.fetchImpl ?? (fetch as unknown as FetchLike); }
  private get headers(): Record<string, string> { return { authorization: `Bearer ${this.opts.token}`, "content-type": "application/json" }; }

  /** Capture the observation time immediately before reading the authoritative account aggregate. */
  async monthlyUsageSnapshot(): Promise<ApifyUsageSnapshot> {
    const observedAt = new Date().toISOString();
    const res = await this.f("https://api.apify.com/v2/users/me/limits", { headers: this.headers });
    if (!res.ok) throw new ApifyUsageUncertainError("Apify account usage could not be verified.");
    const body = await res.json() as { data?: { current?: { monthlyUsageUsd?: unknown }; monthlyUsageCycle?: { startAt?: unknown } } };
    if (typeof body.data?.monthlyUsageCycle?.startAt !== "string" || !Number.isFinite(Date.parse(body.data.monthlyUsageCycle.startAt))) {
      throw new ApifyUsageUncertainError("Apify’s monthly usage period could not be verified.");
    }
    return { monthlyUsageMicros: micros(body.data.current?.monthlyUsageUsd), observedAt, cycleStartAt: body.data.monthlyUsageCycle.startAt };
  }

  /** Start one Actor run with an authoritative vendor-side maximum charge. */
  async startActorRun(actor: string, input: Record<string, unknown>, opts: { maxCostMicros: number; onRunCreated: (runId: string) => void }): Promise<ApifyRun> {
    const maxUsd = (opts.maxCostMicros / 1_000_000).toFixed(6);
    const query = new URLSearchParams({ waitForFinish: "60", timeout: "240", restartOnError: "false", maxTotalChargeUsd: maxUsd });
    const url = `https://api.apify.com/v2/actors/${encodeURIComponent(actor)}/runs?${query}`;
    const res = await this.f(url, { method: "POST", headers: this.headers, body: JSON.stringify(input) });
    if (!res.ok) throw new ApifyUsageUncertainError("Apify did not confirm whether its paid run started.");
    const run = runInfo(await res.json());
    opts.onRunCreated(run.id);
    return run;
  }

  async getActorRun(runId: string): Promise<ApifyRun> {
    const res = await this.f(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}`, { headers: this.headers });
    if (!res.ok) throw new ApifyUsageUncertainError("Apify run usage could not be reconciled.");
    return runInfo(await res.json());
  }

  async getDatasetItems(datasetId: string): Promise<unknown[]> {
    const res = await this.f(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`, { headers: this.headers });
    if (!res.ok) throw new ApifyUsageUncertainError("Apify results could not be retrieved.");
    const items = await res.json();
    if (!Array.isArray(items)) throw new ApifyUsageUncertainError("Apify results were not in the expected format.");
    return items;
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
