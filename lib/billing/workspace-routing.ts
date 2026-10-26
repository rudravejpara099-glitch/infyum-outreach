import type Stripe from "stripe";
import type { Db } from "@/lib/db/core";
import { getSetting } from "@/lib/db/repos/settings";
import { BillingError } from "./errors";

const scopedEvents = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.expired", "checkout.session.async_payment_failed",
  "charge.succeeded", "charge.updated",
]);

export function validBillingWorkspaceId(value: unknown): value is string {
  return value === "legacy" || (typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));
}

export function billingWorkspaceId(db: Db): string {
  const id = getSetting(db, "workspace_id") ?? "legacy";
  if (!validBillingWorkspaceId(id)) throw new BillingError("Invalid billing workspace.");
  return id;
}

/** Only call after verifying the provider signature. Missing scope is old-team compatibility. */
export function eventWorkspaceId(event: Stripe.Event): string | null {
  if (!scopedEvents.has(event.type)) return null;
  const object = event.data.object as { metadata?: Record<string, unknown> | null };
  const rawId = object.metadata?.workspace_id;
  const id = rawId === undefined ? "legacy" : rawId;
  if (!validBillingWorkspaceId(id)) throw new BillingError("Invalid payment workspace.");
  return id;
}

export function assertEventWorkspace(db: Db, event: Stripe.Event): void {
  const workspaceId = eventWorkspaceId(event);
  if (workspaceId !== null && workspaceId !== billingWorkspaceId(db)) throw new BillingError("Payment belongs to a different workspace.");
}

export function checkoutIdempotencyKey(workspaceId: string, statementId: number, attempt: number): string {
  if (!validBillingWorkspaceId(workspaceId)) throw new BillingError("Invalid billing workspace.");
  const prefix = workspaceId === "legacy" ? "billing-test" : `billing-test-workspace-${workspaceId}`;
  return `${prefix}-statement-${statementId}-attempt-${attempt}`;
}
