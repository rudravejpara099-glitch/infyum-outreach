import { describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/repos/campaigns";
import { addLead } from "@/lib/db/repos/leads";
import { addDnc } from "@/lib/db/repos/dnc";
import { setSetting } from "@/lib/db/repos/settings";
import { ApifyClient, ApifyOffError, ApifyUsageUncertainError, MAX_APIFY_RUN_MICROS, toCandidate, type ApifyRun, type ApifySearchClient } from "@/lib/leads/apify";
import { findLeadsForCampaign, termsFor } from "@/lib/services/findLeads";

const finishedAt = new Date(Date.now() - 20_000).toISOString();
function fakeClient(options: { items?: unknown[]; usageMicros?: number; initialStatus?: string } = {}) {
  let starts = 0;
  const runs = new Map<string, ApifyRun>();
  const items = options.items ?? [{ username: "fresh1" }, { username: "fresh2" }];
  const client: ApifySearchClient & { starts: () => number; runs: Map<string, ApifyRun>; monthlyCalls: number } = {
    monthlyCalls: 0,
    async monthlyUsageSnapshot() { this.monthlyCalls++; const date = new Date(); return { monthlyUsageMicros: options.usageMicros ?? 0, observedAt: date.toISOString(), cycleStartAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }; },
    async startActorRun(_actor, _input, { onRunCreated }) {
      starts++;
      const run: ApifyRun = { id: `run-${starts}`, status: options.initialStatus ?? "SUCCEEDED", datasetId: `dataset-${starts}`, usageTotalUsd: 0.03, finishedAt: options.initialStatus === "RUNNING" ? null : finishedAt };
      runs.set(run.id, run); onRunCreated(run.id); return run;
    },
    async getActorRun(id) { const run = runs.get(id); if (!run) throw new Error("missing fake run"); return run; },
    async getDatasetItems() { return items; },
    starts: () => starts,
    runs,
  };
  return client;
}

function fixture(niches = ["Credit repair"], assigned = true) {
  const db = openDb(":memory:");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users(id,email,name,password_hash) VALUES(1,'owner@test.invalid','Owner','fixture')").run();
  const campaign = createCampaign(db, { name: "Test", niches, audienceText: "", country: "United States", minFollowers: 1, maxFollowers: 9, approvalRequired: true, followupsEnabled: true }, [], "test");
  db.prepare("UPDATE campaigns SET status='active' WHERE id=?").run(campaign.id);
  db.prepare("INSERT INTO billing_profiles(user_id,ceiling_micros,consented_at,created_at) VALUES(1,100000000,?,?)").run(now, now);
  if (assigned) db.prepare("INSERT INTO billing_assignments(resource_kind,resource_id,user_id,assigned_at) VALUES('campaign',?,?,?)").run(campaign.id, 1, now);
  db.prepare("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests',?)").run(now);
  db.prepare("INSERT INTO jobs(id,type,payload,status) VALUES(1,'find_leads',?,'running')").run(JSON.stringify({ campaignId: campaign.id }));
  setSetting(db, "apify_monthly_cap_usd", "20");
  return { db, campaign, now };
}

describe("metered Apify search", () => {
  it("accepts common actor result fields and rejects junk", () => {
    expect(toCandidate({ username: "Foo.Bar", followersCount: 5000 }, "x")).toEqual({ handle: "foo.bar", followers: 5000, niche: "x" });
    expect(toCandidate({ ownerUsername: "a_b" }, "x")?.followers).toBeNull();
    expect(toCandidate({ username: "bad handle!" }, "x")).toBeNull();
    expect(toCandidate({}, "x")).toBeNull();
  });

  it("builds search terms from niches, skipping General", () => {
    expect(termsFor(["General", "Credit repair", "credit repair"])).toEqual(["credit repair"]);
    expect(termsFor(["General"])).toEqual(["business coach"]);
  });

  it("reserves before every bounded run and records exact vendor usage", async () => {
    const { db, campaign } = fixture();
    const c = fakeClient({ items: [{ username: "existing" }, { username: "blocked" }, { username: "fresh1" }, { username: "fresh2" }] });
    addLead(db, { handle: "existing" }, "test"); addDnc(db, "blocked");
    const r = await findLeadsForCampaign(db, c, campaign.id, 1);
    expect(r).toEqual({ found: 4, added: 2 });
    expect(c.starts()).toBe(1);
    expect((db.prepare("SELECT status,actual_cost_micros,provider_run_id FROM billing_reservations").get() as object)).toEqual({ status: "settled", actual_cost_micros: 30000, provider_run_id: "run-1" });
    expect(db.prepare("SELECT kind,cost_micros,provider_ref FROM billing_usage_events").get()).toEqual({ kind: "apify", cost_micros: 30000, provider_ref: "run-1" });
  });

  it("stops before dispatch if the global Apify cap is reached", async () => {
    const { db, campaign } = fixture();
    const c = fakeClient({ usageMicros: 18_000_000 });
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toThrow(/cap/);
    expect(c.starts()).toBe(0);
  });

  it("stops if the provider usage cycle does not align with the app's UTC cap month", async () => {
    const { db, campaign } = fixture();
    const c = fakeClient();
    const date = new Date();
    vi.spyOn(c, "monthlyUsageSnapshot").mockResolvedValue({ monthlyUsageMicros: 0, observedAt: date.toISOString(), cycleStartAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 2)).toISOString() });
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toThrow(/does not match this app/);
    expect(c.starts()).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM billing_reservations").get()).toEqual({ n: 0 });
  });

  it("requires campaign payer, billing review and a saved monthly cap", async () => {
    const { db, campaign } = fixture(["Credit repair"], false);
    const c = fakeClient();
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toBeInstanceOf(ApifyOffError);
    db.prepare("INSERT INTO billing_assignments(resource_kind,resource_id,user_id,assigned_at) VALUES('campaign',?,?,?)").run(campaign.id, 1, new Date().toISOString());
    db.prepare("DELETE FROM billing_integration_ack").run();
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toThrow(/reviewed/);
    db.prepare("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests',?)").run(new Date().toISOString());
    setSetting(db, "apify_monthly_cap_usd", "0");
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toBeInstanceOf(ApifyOffError);
    expect(c.starts()).toBe(0);
  });

  it("reconciles an uncertain run by its durable ID instead of starting a duplicate", async () => {
    const { db, campaign } = fixture();
    const c = fakeClient({ initialStatus: "RUNNING" });
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toBeInstanceOf(ApifyUsageUncertainError);
    expect(db.prepare("SELECT status,provider_run_id FROM billing_reservations").get()).toEqual({ status: "held", provider_run_id: "run-1" });
    c.runs.set("run-1", { id: "run-1", status: "SUCCEEDED", datasetId: "dataset-1", usageTotalUsd: 0.03, finishedAt });
    await findLeadsForCampaign(db, c, campaign.id, 1);
    expect(c.starts()).toBe(1);
    expect(db.prepare("SELECT status,actual_cost_micros FROM billing_reservations").get()).toEqual({ status: "settled", actual_cost_micros: 30000 });
  });

  it("does not relaunch when Apify may have started but no run ID was received", async () => {
    const { db, campaign } = fixture();
    const c = fakeClient();
    const start = vi.spyOn(c, "startActorRun").mockRejectedValue(new ApifyUsageUncertainError("unknown start"));
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toBeInstanceOf(ApifyUsageUncertainError);
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toThrow(/no saved run ID/);
    expect(start).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT status,provider_run_id FROM billing_reservations").get()).toEqual({ status: "held", provider_run_id: null });
  });

  it("recovers an old held run before starting a user-requested new search", async () => {
    const { db, campaign } = fixture();
    const c = fakeClient({ initialStatus: "RUNNING" });
    await expect(findLeadsForCampaign(db, c, campaign.id, 1)).rejects.toBeInstanceOf(ApifyUsageUncertainError);
    db.prepare("INSERT INTO jobs(id,type,payload,status) VALUES(2,'find_leads',?,'running')").run(JSON.stringify({ campaignId: campaign.id }));
    c.runs.set("run-1", { id: "run-1", status: "SUCCEEDED", datasetId: "dataset-1", usageTotalUsd: 0.03, finishedAt });
    await expect(findLeadsForCampaign(db, c, campaign.id, 2)).resolves.toEqual({ found: 2, added: 2 });
    expect(c.starts()).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM billing_usage_events WHERE kind='apify'").get()).toEqual({ n: 1 });
  });

  it("sends no secret in the URL and passes the provider run cap", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { current: { monthlyUsageUsd: 0.12 }, monthlyUsageCycle: { startAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString() } } }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.03 } }) });
    const api = new ApifyClient({ token: "test-secret", fetchImpl: fetcher });
    const usage = await api.monthlyUsageSnapshot();
    expect(usage.monthlyUsageMicros).toBe(120000);
    await api.startActorRun("apify~actor", { search: "test" }, { maxCostMicros: MAX_APIFY_RUN_MICROS, onRunCreated: vi.fn() });
    expect(fetcher.mock.calls[0][0]).not.toContain("test-secret");
    expect(fetcher.mock.calls[0][1]?.headers?.authorization).toBe("Bearer test-secret");
    expect(fetcher.mock.calls[1][0]).toContain("/v2/actors/apify~actor/runs?");
    expect(fetcher.mock.calls[1][0]).toContain("maxTotalChargeUsd=0.250000");
    expect(fetcher.mock.calls[1][1]?.headers?.authorization).toBe("Bearer test-secret");
  });
});
