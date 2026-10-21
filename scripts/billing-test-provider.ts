/** Local simulator, never Stripe verification. Holds no card data and sends only signed fake test events. */
import http from "node:http";
import Stripe from "stripe";
import { processorFeeMicros } from "@/lib/billing/statement";
export async function billingTestProvider(appBase: string, webhookSecret: string) {
  const sessions = new Map<string, Record<string, unknown>>(), keys = new Map<string, string>();
  const sdk = new Stripe("sk_test_fixture");
  let origin = "", deliveries = 0;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", origin);
      const body: Buffer[] = []; for await (const chunk of req) body.push(Buffer.from(chunk));
      const params = new URLSearchParams(Buffer.concat(body).toString("utf8"));
      const json = (data: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        const key = String(req.headers["idempotency-key"]), prior = keys.get(key);
        if (prior) return json(sessions.get(prior));
        const id = `cs_test_local_${sessions.size + 1}`, intent = `pi_local_${sessions.size + 1}`;
        const row = { id, object: "checkout.session", livemode: false, mode: params.get("mode"), currency: "usd", amount_total: Number(params.get("line_items[0][price_data][unit_amount]")), client_reference_id: params.get("client_reference_id"), metadata: { statement_id: params.get("metadata[statement_id]"), user_id: params.get("metadata[user_id]"), billing_mode: params.get("metadata[billing_mode]") }, payment_status: "unpaid", status: "open", payment_intent: intent, url: `${origin}/checkout/${id}`, success_url: params.get("success_url"), cancel_url: params.get("cancel_url") };
        sessions.set(id, row); keys.set(key, id); return json(row);
      }
      if (url.pathname.startsWith("/v1/checkout/sessions/")) return json(sessions.get(url.pathname.split("/").pop()!));
      if (url.pathname.startsWith("/v1/payment_intents/")) {
        const row = [...sessions.values()].find(row => row.payment_intent === url.pathname.split("/").pop());
        if (!row) throw new Error("Unknown simulated intent");
        const fee = processorFeeMicros(row.amount_total as number, 290, 300000) / 10000 + 2;
        return json({ id: row.payment_intent, object: "payment_intent", livemode: false, currency: "usd", status: "succeeded", amount_received: row.amount_total, latest_charge: { id: `ch_${row.payment_intent}`, livemode: false, currency: "usd", paid: true, amount: row.amount_total, balance_transaction: { id: `txn_${row.payment_intent}`, object: "balance_transaction", fee, currency: "usd" } } });
      }
      const id = url.pathname.split("/").pop()!, row = sessions.get(id);
      if (!row) { res.writeHead(404); return res.end("Unknown local session"); }
      if (req.method === "GET" && url.pathname.startsWith("/checkout/")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<html><body><h1>Local payment simulator</h1><p>Not Stripe. No card data or money.</p><form method="POST" action="/paid/${id}"><button>Confirm simulated payment</button></form><form method="POST" action="/failed/${id}"><button>Decline simulated payment</button></form></body></html>`);
      }
      if (req.method === "POST" && (/^\/(paid|failed)\//).test(url.pathname)) {
        const paid = url.pathname.startsWith("/paid/"); if (paid) { row.status = "complete"; row.payment_status = "paid"; }
        const payload = JSON.stringify({ id: `evt_local_${id}_${paid ? "paid" : "failed"}`, object: "event", livemode: false, type: paid ? "checkout.session.completed" : "checkout.session.async_payment_failed", data: { object: row } });
        const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
        for (let i = 0; i < 2; i++) {
          const delivery = await fetch(`${appBase}/api/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
          if (!delivery.ok) throw new Error("Simulated webhook delivery failed"); deliveries++;
        }
        res.writeHead(303, { location: String(paid ? row.success_url : row.cancel_url) }); return res.end();
      }
      res.writeHead(404); res.end();
    } catch { res.writeHead(500); res.end("Local simulator error"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Local simulator did not start");
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, deliveries: () => deliveries, sessions: () => sessions.size, close: () => { server.closeAllConnections(); return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
