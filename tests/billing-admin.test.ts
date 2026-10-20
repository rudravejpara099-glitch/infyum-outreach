import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { saveBillingConfig, saveModelRate } from "@/lib/billing/admin";
import { billingConfig, saveCeiling, verifiedModelRate, tokenRate } from "@/lib/billing/config";
import { claimResource } from "@/lib/billing/attribution";
import { assertCampaignCanStart } from "@/lib/billing/guards";
import { addResourceCost } from "@/lib/billing/resources";
import { reserveUsage, settleUsage } from "@/lib/billing/budget";
import { recordUsage } from "@/lib/billing/ledger";
import { finalizeStatement, statementState, breakdown } from "@/lib/billing/statements";
import { csvCell } from "@/lib/billing/csv";
let db: Db;
const jan = "2026-01-01T00:00:00.000Z";
beforeEach(() => {
  process.env.BILLING_OWNER_USER_ID = "1"; db = openDb(":memory:");
  db.exec("INSERT INTO users(id,email,name,password_hash) VALUES(1,'owner@test.invalid','Owner','fake'),(2,'team@test.invalid','Team','fake'); INSERT INTO campaigns(id,name) VALUES(1,'Campaign'); INSERT INTO ig_accounts(id,handle,profile_dir) VALUES(1,'handle','unused'); INSERT INTO campaign_accounts VALUES(1,1);");
  db.exec("INSERT INTO billing_model_rates(id,model,input_micros_per_million,output_micros_per_million,verified,source,created_at) VALUES(2,'fixture-model',1000000,1000000,1,'test-only','2026-01-01T00:00:00.000Z');");
});
afterEach(() => { db.close(); delete process.env.BILLING_OWNER_USER_ID; });
describe("owner, payer and price controls", () => {
  it("allows only the explicit owner to change markup/model prices", () => {
    expect(() => saveBillingConfig(db, 2, { markupPercent: 10, feeBps: 290, fixedFeeMicros: 300000 }, jan)).toThrow("owner");
    expect(() => saveModelRate(db, 2, { model: "test-model", inputMicros: 3, outputMicros: 15, cacheReadMicros: null, cacheWriteMicros: null, source: "https://provider.test/prices", confirmed: true }, jan)).toThrow();
  });
  it("versioned terms start next month and do not retroactively mark up old usage", () => {
    saveBillingConfig(db, 1, { markupPercent: 10, feeBps: 290, fixedFeeMicros: 300000 }, jan);
    expect(billingConfig(db, jan).markup_percent).toBe(0);
    expect(billingConfig(db, "2026-02-01T00:00:00.000Z").markup_percent).toBe(10);
    expect(breakdown(finalizeStatement(db, 1, "2026-01-01", "2026-03-01T00:00:00Z")).markupPercent).toBe(0);
  });
  it("refuses placeholder prices and unknown cached-token rates", () => {
    expect(() => verifiedModelRate(db, "placeholder-update-provider-prices")).toThrow();
    expect(() => saveModelRate(db, 1, { model: "test-model", inputMicros: 3000000, outputMicros: 15000000, cacheReadMicros: null, cacheWriteMicros: null, source: "https://provider.test/prices", confirmed: false }, jan)).toThrow();
    saveModelRate(db, 1, { model: "test-model", inputMicros: 3000000, outputMicros: 15000000, cacheReadMicros: null, cacheWriteMicros: null, source: "https://provider.test/prices", confirmed: true }, jan);
    expect(tokenRate(db, "test-model", "input")).toBe(3000000);
    expect(() => tokenRate(db, "test-model", "cache_read")).toThrow();
  });
  it("pauses paid starts without a reviewed integration and matching sender payer", () => {
    saveCeiling(db, 1, 100000000, jan);
    expect(() => claimResource(db, 1, "campaign", 1, jan)).toThrow("integration");
    expect(() => assertCampaignCanStart(db, 1, 1)).toThrow("payer");
    db.exec("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests','2026-01-01');");
    claimResource(db, 1, "campaign", 1, jan);
    expect(() => assertCampaignCanStart(db, 1, 1)).toThrow("same payer");
    claimResource(db, 1, "account", 1, jan);
    expect(() => assertCampaignCanStart(db, 1, 1)).not.toThrow();
    saveCeiling(db, 1, 0, jan);
    expect(() => assertCampaignCanStart(db, 1, 1)).toThrow();
  });
  it("does not claim active campaigns or resources with pending work", () => {
    saveCeiling(db, 1, 100000000, jan); db.exec("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests','2026-01-01'); UPDATE campaigns SET status='active' WHERE id=1;");
    expect(() => claimResource(db, 1, "campaign", 1, jan)).toThrow("Pause");
    expect(() => claimResource(db, 1, "account", 1, jan)).toThrow("Pause");
    db.exec("UPDATE campaigns SET status='paused'; INSERT INTO jobs(type,payload) VALUES('find_leads','{\"campaignId\":1}');");
    expect(() => claimResource(db, 1, "campaign", 1, jan)).toThrow("pending");
  });
  it("refuses confirmed fixed expenses beyond a payer's ceiling", () => {
    saveCeiling(db, 1, 1000000, jan); db.exec("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests','2026-01-01');"); claimResource(db, 1, "account", 1, jan);
    expect(() => addResourceCost(db, 1, { userId: 1, accountId: 1, kind: "proxy_share", amountMicros: 10000000, reference: "invoice" }, jan)).toThrow("cutoff");
    expect((db.prepare("SELECT count(*) n FROM billing_resource_costs").get() as { n: number }).n).toBe(0);
  });
  it("keeps grace from the statement issue date even after an offline month", () => {
    saveCeiling(db, 1, 100000000, jan); db.exec("INSERT INTO billing_integration_ack VALUES(1,'fixture','tests','2026-01-01');"); claimResource(db, 1, "campaign", 1, jan);
    reserveUsage(db, { userId: 1, operationId: "late", provider: "ai", model: "fixture-model", maxCostMicros: 1000000, source: { campaignId: 1 }, now: jan });
    const event = { userId: 1, eventKey: "late-event", occurredAt: jan, kind: "ai_input_tokens" as const, quantity: 1000000, unitCostMicros: 1000000, unitQuantity: 1000000, costMicros: 1000000, providerRef: "req", model: "fixture-model", rateId: 2, tokenCategory: "input" as const, source: { campaignId: 1 } };
    settleUsage(db, "late", [event], jan);
    expect(() => recordUsage(db, { ...event, eventKey: "forged-extra" }, "late", jan)).toThrow();
    const row = finalizeStatement(db, 1, "2026-01-01", "2026-03-20T00:00:00Z");
    expect(statementState(db, row, "2026-03-21T00:00:00Z")).toBe("Awaiting payment");
    expect(statementState(db, row, "2026-03-27T00:00:00Z")).toBe("Overdue");
  });
  it("rejects non-integral persisted costs and neutralizes CSV formulas", () => {
    expect(() => db.exec("INSERT INTO billing_config(markup_percent,fee_bps,fixed_fee_micros,minimum_cents,proxy_seed_micros,hosting_seed_micros,created_at) VALUES(0.5,290,300000,50,0,0,'2026-01-01')")).toThrow();
    for (const value of ["=HYPERLINK(\"evil\")", "+cmd", "@sum(1)", "-1", "\tbad"]) expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell('safe"value')).toBe('"safe""value"');
  });
});
