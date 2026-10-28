import { describe, expect, it } from "vitest";
import { DEFAULT_PROSPECT_FILTERS as D, evaluateProspect, filtersFromForm, parseProspectFilters } from "@/lib/domain/prospect-filters";

const ok = { handle: "a", followers: 8000, bio: "Credit coach helping people", recentPosts: 4, engagementPct: 2 };

describe("prospect filters", () => {
  it("passes a prospect that meets every rule", () => expect(evaluateProspect(ok, D)).toEqual({ ok: true }));
  it("checks followers both ways", () => {
    expect(evaluateProspect({ ...ok, followers: 500 }, D)).toMatchObject({ ok: false, reason: expect.stringContaining("min 2000") });
    expect(evaluateProspect({ ...ok, followers: 90_000 }, D)).toMatchObject({ ok: false, reason: expect.stringContaining("max 70000") });
  });
  it("skips private accounts and unknown follower counts", () => {
    expect(evaluateProspect({ ...ok, isPrivate: true }, D)).toMatchObject({ ok: false, reason: "Account is private" });
    expect(evaluateProspect({ ...ok, followers: null }, D)).toMatchObject({ ok: false });
  });
  it("checks recent activity only when it is known", () => {
    expect(evaluateProspect({ ...ok, recentPosts: 1 }, D)).toMatchObject({ ok: false, reason: expect.stringContaining("last 14 days") });
    expect(evaluateProspect({ ...ok, recentPosts: undefined }, D)).toEqual({ ok: true });
  });
  it("applies engagement and fit thresholds when switched on", () => {
    const f = { ...D, minEngagementPct: 3, fitThreshold: 60 };
    expect(evaluateProspect(ok, f)).toMatchObject({ ok: false, reason: expect.stringContaining("Engagement") });
    expect(evaluateProspect({ ...ok, engagementPct: 4, fitScore: 40 }, f)).toMatchObject({ ok: false, reason: expect.stringContaining("Fit score") });
    expect(evaluateProspect({ ...ok, engagementPct: 4, fitScore: 80 }, f)).toEqual({ ok: true });
  });
  it("excludes agencies and requires a niche match", () => {
    expect(evaluateProspect({ ...ok, bio: "Full service marketing agency" }, D)).toMatchObject({ ok: false, reason: expect.stringContaining("agency") });
    expect(evaluateProspect({ ...ok, bio: "Dog photographer" }, D)).toMatchObject({ ok: false, reason: "Bio does not match the niche keywords" });
  });
  it("falls back to defaults for missing or broken stored settings", () => {
    expect(parseProspectFilters(null)).toEqual(D);
    expect(parseProspectFilters("not json")).toEqual(D);
    expect(parseProspectFilters(JSON.stringify({ minFollowers: 5000, maxFollowers: 1000 }))).toEqual(D);
    expect(parseProspectFilters(JSON.stringify({ minFollowers: 5000 })).minFollowers).toBe(5000);
  });
  it("validates the settings form", () => {
    const form = { minFollowers: "3000", maxFollowers: "50000", recentDays: "14", minRecentPosts: "2", minEngagementPct: "1.5", fitThreshold: "50", nicheKeywords: "Coach, Credit\ntax", excludeKeywords: "agency", markets: "United States" };
    expect(filtersFromForm(form)).toMatchObject({ filters: { minFollowers: 3000, minEngagementPct: 1.5, nicheKeywords: ["coach", "credit", "tax"] } });
    expect(filtersFromForm({ ...form, minFollowers: "90000" })).toMatchObject({ error: { field: "minFollowers" } });
    expect(filtersFromForm({ ...form, fitThreshold: "150" })).toMatchObject({ error: { field: "fitThreshold" } });
    expect(filtersFromForm({ ...form, recentDays: "" })).toMatchObject({ error: { field: "recentDays" } });
  });
});
