"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { saveCeiling, assertOwner, integrationReady } from "@/lib/billing/config";
import { parseUsd } from "@/lib/billing/money";
import { syncBilling } from "@/lib/billing/sync";
import { claimResource } from "@/lib/billing/attribution";
import { saveBillingConfig, saveModelRate } from "@/lib/billing/admin";
import { addResourceCost } from "@/lib/billing/resources";
import { createCheckout } from "@/lib/billing/checkout";
import { reconcilePendingFees } from "@/lib/billing/webhooks";
import { testStripe } from "@/lib/billing/provider";
import { BillingError, publicBillingError } from "@/lib/billing/errors";
import type { BillingResult } from "@/components/billing-form";
function id(form: FormData, key: string): number { const raw = String(form.get(key)); if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new BillingError("Choose a valid record"); return Number(raw); }
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const failure = (error: unknown): BillingResult => ({ error: publicBillingError(error) });
function refreshed() { revalidatePath("/billing"); revalidatePath("/billing/admin"); }
export async function changeSpendingLimit(form: FormData): Promise<BillingResult> {
  const user = await requireUser();
  try {
    if (form.get("consent") !== "on") throw new BillingError("Confirm that you accept responsibility for assigned usage");
    saveCeiling(getDb(), user.id, parseUsd(text(form, "ceiling"))); syncBilling(getDb(), user.id); refreshed();
    return { message: "Spending limit saved. New paid work pauses at 90% including reserved costs and estimated payment fees." };
  } catch (error) { return failure(error); }
}
export async function refreshBilling(): Promise<BillingResult> {
  const user = await requireUser();
  try { syncBilling(getDb(), user.id); refreshed(); return { message: "Usage and statements refreshed. No payment was taken." }; } catch (error) { return failure(error); }
}
export async function claimBillingResource(form: FormData): Promise<BillingResult> {
  const user = await requireUser();
  try {
    if (!integrationReady(getDb())) throw new BillingError("Assignments open after the metered worker integration is reviewed. Paid work is currently paused.");
    if (form.get("consent") !== "on") throw new BillingError("Confirm that you will pay this resource’s costs");
    const kind = text(form, "kind"); if (kind !== "campaign" && kind !== "account") throw new BillingError("Choose a campaign or Instagram account");
    claimResource(getDb(), user.id, kind, id(form, "resourceId")); refreshed(); return { message: "Assigned to you. Existing activity was not billed." };
  } catch (error) { return failure(error); }
}
export async function payStatement(form: FormData): Promise<BillingResult> {
  const user = await requireUser();
  try { const url = await createCheckout(getDb(), user.id, id(form, "statementId")); return { url }; } catch (error) { return failure(error); }
}
export async function changeBillingConfig(form: FormData): Promise<BillingResult> {
  const user = await requireUser();
  try {
    assertOwner(user.id);
    saveBillingConfig(getDb(), user.id, { feeBps: Number(text(form, "feeBps")), fixedFeeMicros: parseUsd(text(form, "fixedFee")) }); refreshed();
    return { message: "Saved for next calendar month. Existing statements and this month’s terms stay unchanged." };
  } catch (error) { return failure(error); }
}
export async function confirmModelPrices(form: FormData): Promise<BillingResult> {
  const user = await requireUser();
  try {
    assertOwner(user.id);
    const optional = (key: string) => text(form, key) ? parseUsd(text(form, key)) : null;
    saveModelRate(getDb(), user.id, { model: text(form, "model"), inputMicros: parseUsd(text(form, "inputPrice")), outputMicros: parseUsd(text(form, "outputPrice")), cacheReadMicros: optional("cacheRead"), cacheWriteMicros: optional("cacheWrite"), source: text(form, "source"), confirmed: form.get("confirmed") === "on" }); refreshed();
    return { message: "Exact model prices recorded as a new version. Historical usage is unchanged." };
  } catch (error) { return failure(error); }
}
export async function confirmResourceExpense(form: FormData): Promise<BillingResult> {
  const user = await requireUser();
  try {
    assertOwner(user.id); if (form.get("confirmed") !== "on") throw new BillingError("Confirm this is an actual provider expense");
    const kind = text(form, "expenseKind"); if (kind !== "proxy_share" && kind !== "hosting_share") throw new BillingError("Choose an expense type");
    addResourceCost(getDb(), user.id, { userId: id(form, "payerId"), accountId: kind === "proxy_share" ? id(form, "accountId") : undefined, kind, amountMicros: parseUsd(text(form, "amount")), reference: text(form, "reference") }); refreshed();
    return { message: "Confirmed expense saved. First expenses start today; changes apply tomorrow. No estimates were billed." };
  } catch (error) { return failure(error); }
}
export async function refreshPaymentFees(): Promise<BillingResult> {
  const user = await requireUser();
  try { assertOwner(user.id); const count = await reconcilePendingFees(getDb(), testStripe()); refreshed(); return { message: `${count} payment fee${count === 1 ? "" : "s"} reconciled. Unavailable fee data stays pending.` }; } catch (error) { return failure(error); }
}
