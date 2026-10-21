import { getDb } from "@/lib/db";
import { verifyWebhook, testStripe, paymentConfigured } from "@/lib/billing/provider";
import { processWebhook, reconcilePendingFees } from "@/lib/billing/webhooks";
export const runtime = "nodejs";
/** Provider authentication replaces interactive requireUser on this exact endpoint only. */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature || !request.body) return new Response("Missing signature", { status: 400 });
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const chunk = await reader.read(); if (chunk.done) break;
    length += chunk.value.length;
    if (length > 1048576) { await reader.cancel(); return new Response("Payload too large", { status: 413 }); }
    chunks.push(chunk.value);
  }
  let event;
  try { event = verifyWebhook(Buffer.concat(chunks).toString("utf8"), signature); }
  catch { return new Response("Invalid test webhook signature or mode", { status: 400 }); }
  try {
    processWebhook(getDb(), event);
    if (paymentConfigured() && ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.succeeded", "charge.updated"].includes(event.type)) await reconcilePendingFees(getDb(), testStripe());
    return Response.json({ received: true });
  } catch { return new Response("Payment reconciliation pending; retry delivery", { status: 503 }); }
}
