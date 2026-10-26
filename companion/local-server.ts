import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { parseConnectionCode } from "./connection";
import type { ConnectorRuntime } from "./runtime";
import { connectorPage } from "./page";

function matches(value: string, secret: string): boolean {
  const actual = Buffer.from(value), expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function requestAuthorized(request: Pick<IncomingMessage, "headers" | "method">, origin: string, token: string): boolean {
  return request.headers.host === new URL(origin).host &&
    (request.method === "POST" ? request.headers.origin === origin : request.headers.origin === undefined || request.headers.origin === origin) &&
    matches(String(request.headers["x-connector-token"] ?? ""), token);
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of request) { text += String(chunk); if (Buffer.byteLength(text) > 12_000) throw new Error("The connection code is too long."); }
  return JSON.parse(text) as Record<string, unknown>;
}
export async function startLocalServer(runtime: ConnectorRuntime, options: { onQuit?: () => void } = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", `default-src 'none'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
    if (request.method === "GET" && request.url === "/") { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(connectorPage(token)); return; }
    if (!requestAuthorized(request, origin, token)) { response.writeHead(403).end(); return; }
    response.setHeader("content-type", "application/json");
    try {
      if (request.method === "POST" && request.url === "/preview") {
        const body = await readJson(request);
        const { origin: website } = parseConnectionCode(String(body.code ?? ""));
        response.end(JSON.stringify({ website })); return;
      }
      if (request.method === "POST" && request.url === "/connect") {
        if (runtime.isConnected()) throw new Error("Disconnect this workspace before connecting another.");
        const body = await readJson(request);
        const connection = parseConnectionCode(String(body.code ?? ""));
        if (body.website !== connection.origin || body.allow !== true) throw new Error("Review the website and allow this connection first.");
        await runtime.pair(connection.origin, connection.code, "My Mac");
        response.end(JSON.stringify({ ok: true })); return;
      }
      if (request.method === "POST" && request.url === "/disconnect") { runtime.disconnect(); response.end(JSON.stringify({ ok: true })); return; }
      if (request.method === "POST" && request.url === "/quit") {
        runtime.stop(); response.end(JSON.stringify({ ok: true }));
        setImmediate(() => { if (options.onQuit) options.onQuit(); else server.close(); });
        return;
      }
      if (request.method === "GET" && request.url === "/status") { response.end(JSON.stringify({ status: runtime.status, connected: runtime.isConnected() })); return; }
      response.writeHead(404).end(JSON.stringify({ error: "Not found." }));
    } catch (error) {
      response.writeHead(400).end(JSON.stringify({ error: error instanceof Error && /^(Paste|Use|This connection code|The connection code|The website returned|The connection code expired|Review the website|Disconnect this workspace)/.test(error.message) ? error.message : "The connection could not finish. Check the website address and create a new code in Outreach." }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The connector could not open its local window.");
  origin = `http://127.0.0.1:${address.port}`;
  return { url: origin, close: () => !server.listening ? Promise.resolve() : new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
