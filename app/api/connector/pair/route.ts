import { exchangePairing } from "@/lib/connectors/catalog";
import { connectorBody, connectorJson } from "@/lib/connectors/http";
import { getIdentityDb } from "@/lib/workspaces/storage";
export const runtime = "nodejs";
/** One-use, expiring pairing code replaces a browser session on this exact route. */
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return connectorJson({ error: "Origin denied." }, 403);
  try {
    const input = await connectorBody(request);
    if (typeof input.code !== "string" || typeof input.label !== "string") return connectorJson({ error: "Invalid connection code." }, 400);
    return connectorJson(exchangePairing(getIdentityDb(), input.code, input.label));
  } catch { return connectorJson({ error: "The connection code expired or was already used. Create another one in Accounts." }, 400); }
}
