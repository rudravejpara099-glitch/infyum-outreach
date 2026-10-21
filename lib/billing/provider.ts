import { BillingError } from "./errors";
import Stripe from "stripe";
/** No live-mode key, endpoint or fallback can be used by this integration. */
export function testStripe(secret = process.env.STRIPE_SECRET_KEY): Stripe {
  if (!secret?.startsWith("sk_test_")) throw new BillingError("Stripe TEST mode is not configured");
  const options: Stripe.StripeConfig = { maxNetworkRetries: 0, timeout: 20000 };
  const base = localTestApi();
  if (base) { const url = new URL(base); options.host = url.hostname; options.port = Number(url.port); options.protocol = "http"; }
  return new Stripe(secret, options);
}
export function localTestApi(): string | null {
  const raw = process.env.BILLING_TEST_API_BASE;
  if (!raw) return null;
  if (process.env.NODE_ENV === "production" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(raw)) throw new BillingError("Local payment simulator is allowed only on loopback outside production");
  return raw;
}
export function checkoutUrlAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password) || (!!localTestApi() && url.origin === localTestApi());
  } catch { return false; }
}
export function appOrigin(): string {
  const url = new URL(process.env.APP_URL ?? "http://127.0.0.1:3100");
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) throw new BillingError("Configure a trusted application URL");
  return url.origin;
}
export function paymentConfigured(): boolean { return !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") && !!process.env.STRIPE_WEBHOOK_SECRET; }
export function verifyWebhook(raw: string, signature: string, secret = process.env.STRIPE_WEBHOOK_SECRET): Stripe.Event {
  if (!secret) throw new BillingError("Test webhook signing secret is not configured");
  // The SDK verifies timestamp tolerance and the exact raw body. No card data is persisted.
  const event = new Stripe("sk_test_signature_verification_only").webhooks.constructEvent(raw, signature, secret);
  if (event.livemode !== false) throw new BillingError("Live payment events are disabled");
  return event;
}
