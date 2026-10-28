// The roadmap's prospect filters as one editable set. Pure rules: no I/O, so they are easy to test and reuse.
export type ProspectFilters = {
  minFollowers: number;
  maxFollowers: number;
  /** Must have posted at least this many times in the last `recentDays` days. */
  recentDays: number;
  minRecentPosts: number;
  /** (likes + comments) per follower on recent posts, as a percentage. 0 switches the check off. */
  minEngagementPct: number;
  /** A bio must mention at least one of these. Empty means any niche. */
  nicheKeywords: string[];
  /** Skip a bio that mentions any of these (agencies, competitors, big brands). */
  excludeKeywords: string[];
  /** Preferred markets, informational for scoring. */
  markets: string[];
  /** 0 to 100. Leads scoring below this are not carried forward. 0 switches the score gate off. */
  fitThreshold: number;
};

export const DEFAULT_PROSPECT_FILTERS: ProspectFilters = {
  minFollowers: 2_000,
  maxFollowers: 70_000,
  recentDays: 14,
  minRecentPosts: 2,
  minEngagementPct: 0,
  nicheKeywords: ["coach", "consultant", "credit", "tax", "funding", "bookkeeping"],
  excludeKeywords: ["agency", "marketing agency", "official page"],
  markets: ["United States", "United Kingdom", "Canada", "Australia"],
  fitThreshold: 0,
};

export type ProspectProfile = {
  handle: string;
  followers: number | null;
  bio?: string;
  isPrivate?: boolean;
  /** Posts in the last `recentDays` days, when known. */
  recentPosts?: number | null;
  /** (likes + comments) / followers as a percentage, when known. */
  engagementPct?: number | null;
  /** 0 to 100, when scored. */
  fitScore?: number | null;
};

export type FilterVerdict = { ok: true } | { ok: false; reason: string };

const list = (value: unknown, max = 40): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map((v) => String(v).trim().toLowerCase()).filter(Boolean))].slice(0, max)
    : [];

/** Reads stored settings, falling back to the defaults for anything missing or invalid. */
export function parseProspectFilters(raw: string | null): ProspectFilters {
  if (!raw) return { ...DEFAULT_PROSPECT_FILTERS };
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; } catch { return { ...DEFAULT_PROSPECT_FILTERS }; }
  const num = (key: keyof ProspectFilters, min: number, max: number): number => {
    const n = Number(value[key]);
    return Number.isFinite(n) && n >= min && n <= max ? n : DEFAULT_PROSPECT_FILTERS[key] as number;
  };
  const out: ProspectFilters = {
    minFollowers: Math.round(num("minFollowers", 0, 10_000_000)),
    maxFollowers: Math.round(num("maxFollowers", 1, 100_000_000)),
    recentDays: Math.round(num("recentDays", 1, 365)),
    minRecentPosts: Math.round(num("minRecentPosts", 0, 100)),
    minEngagementPct: num("minEngagementPct", 0, 100),
    nicheKeywords: "nicheKeywords" in value ? list(value.nicheKeywords) : DEFAULT_PROSPECT_FILTERS.nicheKeywords,
    excludeKeywords: "excludeKeywords" in value ? list(value.excludeKeywords) : DEFAULT_PROSPECT_FILTERS.excludeKeywords,
    markets: "markets" in value ? list(value.markets, 12) : DEFAULT_PROSPECT_FILTERS.markets,
    fitThreshold: Math.round(num("fitThreshold", 0, 100)),
  };
  if (out.minFollowers > out.maxFollowers) return { ...DEFAULT_PROSPECT_FILTERS };
  return out;
}

export type FilterInputError = { field: keyof ProspectFilters; message: string };

/** Turns the settings form into filters, or says which field is wrong. */
export function filtersFromForm(form: Record<string, string>): { filters: ProspectFilters } | { error: FilterInputError } {
  const whole = (field: keyof ProspectFilters, label: string, min: number, max: number): number | FilterInputError => {
    const raw = (form[field] ?? "").trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n < min || n > max) return { field, message: `${label} must be a number from ${min} to ${max}.` };
    return n;
  };
  const picks = {
    minFollowers: whole("minFollowers", "Minimum followers", 0, 10_000_000),
    maxFollowers: whole("maxFollowers", "Maximum followers", 1, 100_000_000),
    recentDays: whole("recentDays", "Recent days", 1, 365),
    minRecentPosts: whole("minRecentPosts", "Minimum recent posts", 0, 100),
    minEngagementPct: whole("minEngagementPct", "Minimum engagement", 0, 100),
    fitThreshold: whole("fitThreshold", "Fit score threshold", 0, 100),
  };
  for (const v of Object.values(picks)) if (typeof v === "object") return { error: v };
  const n = picks as Record<keyof typeof picks, number>;
  if (n.minFollowers > n.maxFollowers) return { error: { field: "minFollowers", message: "Minimum followers cannot be higher than the maximum." } };
  const words = (raw: string | undefined) => list((raw ?? "").split(/[,\n]/));
  return {
    filters: {
      minFollowers: Math.round(n.minFollowers), maxFollowers: Math.round(n.maxFollowers),
      recentDays: Math.round(n.recentDays), minRecentPosts: Math.round(n.minRecentPosts),
      minEngagementPct: n.minEngagementPct, fitThreshold: Math.round(n.fitThreshold),
      nicheKeywords: words(form.nicheKeywords), excludeKeywords: words(form.excludeKeywords), markets: words(form.markets),
    },
  };
}

/** The roadmap's rule filters, in the order they are checked. The first failure is the reason. */
export function evaluateProspect(profile: ProspectProfile, f: ProspectFilters): FilterVerdict {
  const fail = (reason: string): FilterVerdict => ({ ok: false, reason });
  if (profile.isPrivate) return fail("Account is private");
  if (profile.followers === null || profile.followers === undefined) return fail("Follower count unknown");
  if (profile.followers < f.minFollowers) return fail(`Only ${profile.followers} followers (min ${f.minFollowers})`);
  if (profile.followers > f.maxFollowers) return fail(`${profile.followers} followers (max ${f.maxFollowers})`);
  if (f.minRecentPosts > 0 && profile.recentPosts !== undefined && profile.recentPosts !== null && profile.recentPosts < f.minRecentPosts) {
    return fail(`Only ${profile.recentPosts} posts in the last ${f.recentDays} days (min ${f.minRecentPosts})`);
  }
  if (f.minEngagementPct > 0 && profile.engagementPct !== undefined && profile.engagementPct !== null && profile.engagementPct < f.minEngagementPct) {
    return fail(`Engagement ${profile.engagementPct.toFixed(1)}% (min ${f.minEngagementPct}%)`);
  }
  const bio = (profile.bio ?? "").toLowerCase();
  const hit = f.excludeKeywords.find((word) => bio.includes(word));
  if (hit) return fail(`Bio mentions "${hit}"`);
  if (f.nicheKeywords.length > 0 && profile.bio !== undefined && !f.nicheKeywords.some((word) => bio.includes(word))) {
    return fail("Bio does not match the niche keywords");
  }
  if (f.fitThreshold > 0 && profile.fitScore !== undefined && profile.fitScore !== null && profile.fitScore < f.fitThreshold) {
    return fail(`Fit score ${profile.fitScore} (min ${f.fitThreshold})`);
  }
  return { ok: true };
}
