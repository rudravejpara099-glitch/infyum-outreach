import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
const mocks = vi.hoisted(() => ({ getWorkspaceDb: vi.fn(), processWebhook: vi.fn(), reconcilePendingFees: vi.fn() }));
vi.mock("@/lib/workspaces/storage", () => ({ getWorkspaceDb: mocks.getWorkspaceDb }));
vi.mock("@/lib/billing/webhooks", () => ({ processWebhook: mocks.processWebhook, reconcilePendingFees: mocks.reconcilePendingFees }));
import { POST } from "@/app/api/billing/webhook/route";
const secret = "whsec_tenant_fixture";
const stripe = new Stripe("sk_test_signatures_only");
const company = "a499a284-76b5-4ee8-95ca-7edb55c28bad";
function request(type: string, metadata?: Record<string, unknown>, signatureValid = true): Request {
  const payload = JSON.stringify({ id: "evt_fixture", livemode: false, type, data: { object: { metadata } } });
  return new Request("http://localhost/api/billing/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signatureValid ? stripe.webhooks.generateTestHeaderString({ payload, secret }) : "invalid" } });
}
beforeEach(() => { vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret); vi.stubEnv("STRIPE_SECRET_KEY", ""); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());

describe("signed provider workspace routing", () => {
  it("verifies the signature before consulting any workspace", async () => {
    expect((await POST(request("checkout.session.completed", { workspace_id: company }, false))).status).toBe(400);
    expect(mocks.getWorkspaceDb).not.toHaveBeenCalled();
    expect(mocks.processWebhook).not.toHaveBeenCalled();
  });
  it("routes without any user cookie and gives processing exactly that company's database", async () => {
    const database = { company };
    mocks.getWorkspaceDb.mockReturnValue(database);
    expect((await POST(request("checkout.session.completed", { workspace_id: company }))).status).toBe(200);
    expect(mocks.getWorkspaceDb).toHaveBeenCalledWith(company);
    expect(mocks.processWebhook).toHaveBeenCalledWith(database, expect.objectContaining({ id: "evt_fixture" }));
  });
  it("keeps legacy metadata compatibility and acknowledges unrelated events without opening a database", async () => {
    mocks.getWorkspaceDb.mockReturnValue({ legacy: true });
    expect((await POST(request("charge.updated", { billing_mode: "test" }))).status).toBe(200);
    expect(mocks.getWorkspaceDb).toHaveBeenCalledWith("legacy");
    vi.clearAllMocks();
    expect((await POST(request("customer.created"))).status).toBe(200);
    expect(mocks.getWorkspaceDb).not.toHaveBeenCalled();
  });
  it("rejects malformed or unknown workspace scope and never falls back to the owner", async () => {
    expect((await POST(request("charge.updated", { workspace_id: "../../legacy" }))).status).toBe(503);
    expect(mocks.getWorkspaceDb).not.toHaveBeenCalled();
    mocks.getWorkspaceDb.mockImplementation(() => { throw new Error("Workspace not found"); });
    expect((await POST(request("checkout.session.completed", { workspace_id: company }))).status).toBe(503);
    expect(mocks.getWorkspaceDb).toHaveBeenCalledOnce();
    expect(mocks.processWebhook).not.toHaveBeenCalled();
  });
});
