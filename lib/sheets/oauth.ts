import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { challengeFor, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, type Flow } from "@/lib/auth/google";

/** Connecting Google Sheets is a separate consent from signing in: it asks for the spreadsheets scope and keeps a refresh token,
 * so the worker can sync without a person present. The token is stored encrypted, in this workspace's own settings. */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const SHEETS_FLOW_COOKIE = "g_sheets";

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function sheetsAuthorizationUrl(input: { clientId: string; redirectUri: string; flow: Flow }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: SHEETS_SCOPE,
    state: input.flow.state, code_challenge: challengeFor(input.flow.verifier), code_challenge_method: "S256",
    // offline + consent is what makes Google hand back a refresh token.
    access_type: "offline", prompt: "consent", include_granted_scopes: "false",
  }).toString();
  return url.toString();
}

export type SheetsTokens = { refreshToken: string; accessToken: string; expiresAt: number };

export async function exchangeSheetsCode(input: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: Fetch; now?: () => number }): Promise<SheetsTokens> {
  const post = input.fetchImpl ?? (fetch as unknown as Fetch);
  const response = await post(GOOGLE_TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code", code_verifier: input.verifier }).toString(),
  });
  const body = (await response.json().catch(() => null)) as { refresh_token?: unknown; access_token?: unknown; expires_in?: unknown; scope?: unknown } | null;
  if (!response.ok || typeof body?.access_token !== "string") throw new Error("Google did not accept the Sheets connection.");
  if (typeof body.refresh_token !== "string" || !body.refresh_token) throw new Error("Google did not return a lasting connection. Connect again and allow access.");
  if (typeof body.scope !== "string" || !body.scope.split(" ").includes(SHEETS_SCOPE)) throw new Error("Google Sheets access was not granted.");
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { refreshToken: body.refresh_token, accessToken: body.access_token, expiresAt: (input.now ?? Date.now)() + seconds * 1000 };
}

export async function refreshSheetsToken(input: { refreshToken: string; clientId: string; clientSecret: string; fetchImpl?: Fetch; now?: () => number }): Promise<{ accessToken: string; expiresAt: number }> {
  const post = input.fetchImpl ?? (fetch as unknown as Fetch);
  const response = await post(GOOGLE_TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret, grant_type: "refresh_token" }).toString(),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!response.ok || typeof body?.access_token !== "string") throw new Error("Google refused to renew the Sheets connection. Connect it again in Settings.");
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { accessToken: body.access_token, expiresAt: (input.now ?? Date.now)() + seconds * 1000 };
}

/** AES-256-GCM with a key derived from the server secret; the stored text is `v1.<iv>.<tag>.<data>`, all base64url. */
const keyFor = (secret: string) => createHash("sha256").update(`sheets-token:${secret}`).digest();
export function sealSecret(plain: string, secret: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function openSecret(sealed: string, secret: string): string | null {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}
