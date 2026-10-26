import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { checkoutIdempotencyKey, eventWorkspaceId, validBillingWorkspaceId } from "@/lib/billing/workspace-routing";
const companyA = "a499a284-76b5-4ee8-95ca-7edb55c28bad";
const companyB = "2b041912-2315-430e-8980-b2ec5a50cf28";
const event = (type: string, metadata?: Record<string, unknown>) => ({ type, data: { object: { metadata } } }) as Stripe.Event;

describe("billing workspace routing rules", () => {
  it("keeps old attempts' keys stable and separates matching statement IDs across companies", () => {
    expect(checkoutIdempotencyKey("legacy", 1, 1)).toBe("billing-test-statement-1-attempt-1");
    expect(new Set(["legacy", companyA, companyB].map((id) => checkoutIdempotencyKey(id, 1, 1))).size).toBe(3);
    expect(checkoutIdempotencyKey(companyA, 1, 1)).not.toBe(checkoutIdempotencyKey(companyA, 1, 2));
  });
  it("routes old metadata only to the original team and new metadata to its exact company", () => {
    expect(eventWorkspaceId(event("checkout.session.completed"))).toBe("legacy");
    expect(eventWorkspaceId(event("charge.updated", { billing_mode: "test" }))).toBe("legacy");
    expect(eventWorkspaceId(event("checkout.session.completed", { workspace_id: companyA }))).toBe(companyA);
    expect(eventWorkspaceId(event("charge.succeeded", { workspace_id: companyB }))).toBe(companyB);
    expect(eventWorkspaceId(event("customer.created", { workspace_id: "ignored" }))).toBeNull();
  });
  it("rejects malformed company scope instead of falling back or using it as a path", () => {
    for (const value of [null, "", "../legacy", "Legacy", "legacy ", "not-a-company", {}, 1, companyA.toUpperCase()]) {
      expect(validBillingWorkspaceId(value)).toBe(false);
      expect(() => eventWorkspaceId(event("checkout.session.completed", { workspace_id: value }))).toThrow();
    }
  });
});
