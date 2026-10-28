import "server-only";
import { getIdentityDb, getWorkspaceDb } from "@/lib/workspaces/storage";
import { authenticateDevice, touchDevice } from "./catalog";
import { getAccount } from "@/lib/db/repos/accounts";
import type { Command, WireCommand } from "./protocol";

export function connectorJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export async function connectorBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Use JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body.");
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const item = await reader.read(); if (item.done) break;
    size += item.value.length;
    if (size > 128_000) { await reader.cancel(); throw new Error("Request too large."); }
    parts.push(item.value);
  }
  const data: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid request.");
  return data as Record<string, unknown>;
}
/** Same-site pages and the Outreach Chrome extension may call the connector; the device token still gates all data. */
export function connectorOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
export function connectorContext(request: Request) {
  if (!connectorOriginAllowed(request)) return connectorJson({ error: "Origin denied." }, 403);
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) return connectorJson({ error: "Reconnect this device in Accounts." }, 401);
  const identity = getIdentityDb(), device = authenticateDevice(identity, match[1]);
  if (!device) return connectorJson({ error: "Reconnect this device in Accounts." }, 401);
  touchDevice(identity, device.id);
  const db = getWorkspaceDb(device.workspaceId);
  db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`device_seen_${device.id}`, String(Date.now()));
  return { identity, device, db };
}
export function wireCommand(db: ReturnType<typeof getWorkspaceDb>, command: Command): WireCommand & { callbackResponse?: Command["callbackResponse"] } {
  const account = getAccount(db, command.accountId);
  if (!account) throw new Error("Account unavailable.");
  return { id: command.id, kind: command.kind, args: command.args, expiresAt: command.expiresAt, account: { id: account.id, handle: account.handle }, ...(command.callbackResponse ? { callbackResponse: command.callbackResponse } : {}) };
}
