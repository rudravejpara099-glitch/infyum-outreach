import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { addDnc } from "@/lib/db/repos/dnc";
import { setSetting } from "@/lib/db/repos/settings";
import { ApifyOffError, searchLeads, toCandidate } from "@/lib/leads/apify";
import { findLeadsForCampaign, termsFor } from "@/lib/services/findLeads";

const client = (items: unknown[], usage = 0) => ({ calls: 0, async monthlyUsageUsd() { return usage; }, async runActor() { this.calls++; return items; } });

describe("apify search", () => {
  it("accepts the common field spellings and rejects junk", () => {
    expect(toCandidate({ username: "Foo.Bar", followersCount: 5000 }, "x")).toEqual({ handle: "foo.bar", followers: 5000, niche: "x" });
    expect(toCandidate({ ownerUsername: "a_b" }, "x")?.followers).toBeNull();
    expect(toCandidate({ username: "bad handle!" }, "x")).toBeNull();
    expect(toCandidate({}, "x")).toBeNull();
  });
  it("is off until a limit is set", async () => {
    await expect(searchLeads(client([]), { capUsd: null, terms: ["a"], perTerm: 5 })).rejects.toBeInstanceOf(ApifyOffError);
  });
  it("stops before the limit and never runs once it is reached", async () => {
    const c = client([{ username: "x1" }], 9.5);
    await expect(searchLeads(c, { capUsd: 10, terms: ["a"], perTerm: 5 })).rejects.toThrow(/limit reached/);
    expect(c.calls).toBe(0);
  });
  it("dedupes across search terms", async () => {
    const out = await searchLeads(client([{ username: "same" }, { username: "other" }]), { capUsd: 10, terms: ["a", "b"], perTerm: 5 });
    expect(out.map((o) => o.handle).sort()).toEqual(["other", "same"]);
  });
});

describe("find leads for a campaign", () => {
  it("builds terms from niches, skipping General", () => {
    expect(termsFor(["General", "Credit repair", "credit repair"])).toEqual(["credit repair"]);
    expect(termsFor(["General"])).toEqual(["business coach"]);
  });
  it("adds new leads, skipping duplicates and do-not-contact handles", async () => {
    const db = openDb(":memory:");
    const camp = createCampaign(db, { name: "c", niches: ["Credit repair"], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 9, bookingLink: "", approvalRequired: true, followupsEnabled: true }, [], "t");
    setSetting(db, "apify_monthly_cap_usd", "20");
    addLead(db, { handle: "existing" }, "t");
    addDnc(db, "blocked");
    const r = await findLeadsForCampaign(db, client([{ username: "existing" }, { username: "blocked" }, { username: "fresh1" }, { username: "fresh2" }]), camp.id);
    expect(r).toEqual({ found: 4, added: 2 });
  });
  it("does nothing while the limit is unset", async () => {
    const db = openDb(":memory:");
    const camp = createCampaign(db, { name: "c", niches: [], audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 9, bookingLink: "", approvalRequired: true, followupsEnabled: true }, [], "t");
    await expect(findLeadsForCampaign(db, client([{ username: "x" }]), camp.id)).rejects.toBeInstanceOf(ApifyOffError);
  });
});
