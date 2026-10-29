import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";

/**
 * Google sign-in, authorization-code flow with PKCE (build plan Phase 2: Google sign-in).
 * Pure helpers: every network call and key source is passed in, so each rule is testable.
 */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const FLOW_COOKIE = "g_oauth";
export const FLOW_SECONDS = 600;

export type Intent = "login" | "link";
export type Flow = { state: string; nonce: string; verifier: string; intent: Intent };
export type GoogleClaims = { sub: string; email: string; name: string };

const random = () => randomBytes(32).toString("base64url");
export const newFlow = (intent: Intent = "login"): Flow => ({ state: random(), nonce: random(), verifier: random(), intent });
export const challengeFor = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

export function authorizationUrl(input: { clientId: string; redirectUri: string; flow: Flow }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: "openid email profile",
    state: input.flow.state, nonce: input.flow.nonce, code_challenge: challengeFor(input.flow.verifier), code_challenge_method: "S256",
    prompt: "select_account", access_type: "online",
  }).toString();
  return url.toString();
}

/** The one-time secrets of a sign-in attempt travel in a short-lived signed cookie, never in the URL. */
export async function sealFlow(flow: Flow, key: Uint8Array): Promise<string> {
  return new SignJWT({ st: flow.state, no: flow.nonce, ver: flow.verifier, int: flow.intent }).setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${FLOW_SECONDS}s`).sign(key);
}
export async function openFlow(token: string | undefined, key: Uint8Array): Promise<Flow | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return typeof payload.st === "string" && typeof payload.no === "string" && typeof payload.ver === "string" && (payload.int === "login" || payload.int === "link")
      ? { state: payload.st, nonce: payload.no, verifier: payload.ver, intent: payload.int } : null;
  } catch { return null; }
}
export function sameState(a: string | null | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Trades the one-time code for Google's signed ID token. The client secret never leaves the server. */
export async function exchangeCode(input: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: Fetch }): Promise<string> {
  const post = input.fetchImpl ?? (fetch as unknown as Fetch);
  const response = await post(GOOGLE_TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code", code_verifier: input.verifier }).toString(),
  });
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!response.ok || typeof body?.id_token !== "string") throw new Error("Google did not accept the sign-in.");
  return body.id_token;
}

let remoteKeys: JWTVerifyGetKey | undefined;
export const googleKeys = (): JWTVerifyGetKey => (remoteKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));

/** Signature, issuer, audience, expiry, nonce and a verified email: all must hold. */
export async function verifyIdToken(idToken: string, input: { clientId: string; nonce: string; keys: JWTVerifyGetKey }): Promise<GoogleClaims> {
  const { payload } = await jwtVerify(idToken, input.keys, { algorithms: ["RS256"], issuer: ISSUERS, audience: input.clientId });
  if (payload.nonce !== input.nonce) throw new Error("Sign-in answer did not match this attempt.");
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || !payload.email) throw new Error("Google did not share an email address.");
  if (payload.email_verified !== true) throw new Error("This Google email is not verified.");
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name : payload.email };
}
