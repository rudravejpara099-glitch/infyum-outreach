import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { openDb } from "@/lib/db/core";
import { createUser } from "@/lib/db/repos/users";
import { createWorkspace } from "@/lib/workspaces/catalog";
import { authorizationUrl, challengeFor, exchangeCode, newFlow, openFlow, sameState, sealFlow, verifyIdToken } from "@/lib/auth/google";
import { googleLinkOf, linkGoogle, resolveGoogleUser, unlinkGoogle } from "@/lib/auth/google-signin";

const CLIENT = "123-abc.apps.googleusercontent.com";
const secret = new TextEncoder().encode("x".repeat(40));

async function googleSide() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string | number; alg?: string } = {}) =>
    new SignJWT({ email_verified: true, ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.iss ?? "https://accounts.google.com").setAudience(o.aud ?? CLIENT).setIssuedAt().setExpirationTime(o.exp ?? "5m").sign(privateKey);
  return { keys, sign };
}

describe("the sign-in request", () => {
  it("uses the standard PKCE method (RFC 7636 test vector)", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("asks Google for a code with state, nonce and a challenge, and never includes the secret or the verifier", () => {
    const flow = newFlow();
    const url = new URL(authorizationUrl({ clientId: CLIENT, redirectUri: "http://localhost:3000/api/auth/google/callback", flow }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: CLIENT, response_type: "code", scope: "openid email profile", state: flow.state, nonce: flow.nonce, code_challenge_method: "S256", code_challenge: challengeFor(flow.verifier) });
    expect(url.toString()).not.toContain(flow.verifier);
    expect(new Set([flow.state, flow.nonce, flow.verifier]).size).toBe(3);
  });
  it("keeps the one-time secrets in a signed, expiring cookie that nobody else can forge", async () => {
    const flow = newFlow("link"), token = await sealFlow(flow, secret);
    expect(await openFlow(token, secret)).toEqual(flow);
    expect(flow.intent).toBe("link");
    expect(await openFlow(token, new TextEncoder().encode("y".repeat(40)))).toBeNull();
    expect(await openFlow(undefined, secret)).toBeNull();
    expect(await openFlow("garbage", secret)).toBeNull();
    const expired = await new SignJWT({ st: "a", no: "b", ver: "c", int: "login" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(secret);
    expect(await openFlow(expired, secret)).toBeNull();
  });
  it("compares state strictly", () => {
    expect(sameState("abc", "abc")).toBe(true);
    expect(sameState("abc", "abd")).toBe(false);
    expect(sameState("abc", "abcd")).toBe(false);
    expect(sameState(null, "abc")).toBe(false);
    expect(sameState("abc", undefined)).toBe(false);
  });
});

describe("trading the code for an ID token", () => {
  it("sends the secret and the PKCE verifier to Google and returns the ID token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id_token: "tok" }) });
    expect(await exchangeCode({ code: "c1", verifier: "v1", clientId: CLIENT, clientSecret: "s3cret", redirectUri: "http://x/cb", fetchImpl })).toBe("tok");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body);
    expect(Object.fromEntries(body)).toMatchObject({ code: "c1", code_verifier: "v1", client_secret: "s3cret", grant_type: "authorization_code", redirect_uri: "http://x/cb" });
  });
  it("refuses when Google says no or answers with no ID token", async () => {
    const no = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "invalid_grant" }) });
    await expect(exchangeCode({ code: "c", verifier: "v", clientId: CLIENT, clientSecret: "s", redirectUri: "r", fetchImpl: no })).rejects.toThrow();
    const empty = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(exchangeCode({ code: "c", verifier: "v", clientId: CLIENT, clientSecret: "s", redirectUri: "r", fetchImpl: empty })).rejects.toThrow();
  });
});

describe("checking Google's ID token", () => {
  it("accepts a good token and returns who signed in", async () => {
    const { keys, sign } = await googleSide();
    const token = await sign({ sub: "g-1", email: "Owner@Example.com", name: "Owner", nonce: "n1" });
    expect(await verifyIdToken(token, { clientId: CLIENT, nonce: "n1", keys })).toEqual({ sub: "g-1", email: "owner@example.com", name: "Owner" });
  });
  it("refuses wrong audience, wrong issuer, expired, wrong nonce, unverified email, no email", async () => {
    const { keys, sign } = await googleSide();
    const check = (token: string, nonce = "n1") => verifyIdToken(token, { clientId: CLIENT, nonce, keys });
    await expect(check(await sign({ sub: "s", email: "a@b.c", nonce: "n1" }, { aud: "someone-else" }))).rejects.toThrow();
    await expect(check(await sign({ sub: "s", email: "a@b.c", nonce: "n1" }, { iss: "https://evil.example" }))).rejects.toThrow();
    await expect(check(await sign({ sub: "s", email: "a@b.c", nonce: "n1" }, { exp: Math.floor(Date.now() / 1000) - 120 }))).rejects.toThrow();
    await expect(check(await sign({ sub: "s", email: "a@b.c", nonce: "other" }))).rejects.toThrow(/did not match/);
    await expect(check(await sign({ sub: "s", email: "a@b.c", nonce: "n1", email_verified: false }))).rejects.toThrow(/not verified/);
    await expect(check(await sign({ sub: "s", nonce: "n1" }))).rejects.toThrow(/email/);
  });
  it("refuses a token signed with someone else's key, and an unsigned one", async () => {
    const { keys } = await googleSide();
    const other = await googleSide();
    const forged = await other.sign({ sub: "s", email: "a@b.c", nonce: "n1" });
    await expect(verifyIdToken(forged, { clientId: CLIENT, nonce: "n1", keys })).rejects.toThrow();
    const unsigned = [Buffer.from('{"alg":"none"}').toString("base64url"), Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, sub: "s", email: "a@b.c", email_verified: true, nonce: "n1", exp: 9999999999 })).toString("base64url"), ""].join(".");
    await expect(verifyIdToken(unsigned, { clientId: CLIENT, nonce: "n1", keys })).rejects.toThrow();
  });
});

describe("who may sign in", () => {
  const claims = (sub: string, email = "owner@example.com") => ({ sub, email, name: "N" });
  function team() {
    const db = openDb(":memory:");
    const owner = createUser(db, "owner@example.com", "Owner", "hash");
    createWorkspace(db, owner.id, "First");
    return { db, owner };
  }
  it("never matches by email: a Google account that was not linked from inside the app is refused, even with the team's email", () => {
    const { db } = team();
    expect(resolveGoogleUser(db, claims("g-1"))).toEqual({ ok: false, reason: "not_linked" });
    expect((db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c).toBe(1);   // and no account is ever created
  });
  it("lets a person in after they linked their Google account while signed in", () => {
    const { db, owner } = team();
    expect(linkGoogle(db, owner.id, claims("g-1"))).toEqual({ ok: true });
    expect(resolveGoogleUser(db, claims("g-1"))).toMatchObject({ ok: true, user: { id: owner.id } });
    expect(googleLinkOf(db, owner.id)).toMatchObject({ email: "owner@example.com" });
  });
  it("is not fooled by a pre-registered account with the victim's email", () => {
    const db = openDb(":memory:");
    const attacker = createUser(db, "victim@example.com", "Attacker", "attacker-hash");   // open registration, email unverified
    createWorkspace(db, attacker.id, "Attacker's");
    expect(resolveGoogleUser(db, claims("victim-google-id", "victim@example.com"))).toEqual({ ok: false, reason: "not_linked" });
  });
  it("links one Google account to one person only", () => {
    const { db, owner } = team();
    const second = createUser(db, "second@example.com", "Second", "hash"); createWorkspace(db, second.id, "Second's");
    linkGoogle(db, owner.id, claims("g-1"));
    expect(linkGoogle(db, second.id, claims("g-1"))).toEqual({ ok: false, reason: "taken" });
    expect(linkGoogle(db, owner.id, claims("g-2"))).toEqual({ ok: false, reason: "already_linked" });
    expect(linkGoogle(db, owner.id, claims("g-1"))).toEqual({ ok: true });                // linking again is harmless
  });
  it("stops working once unlinked, and refuses someone who no longer belongs to any workspace", () => {
    const { db, owner } = team();
    linkGoogle(db, owner.id, claims("g-1"));
    unlinkGoogle(db, owner.id);
    expect(resolveGoogleUser(db, claims("g-1"))).toEqual({ ok: false, reason: "not_linked" });
    const orphan = createUser(db, "orphan@example.com", "O", "hash");
    linkGoogle(db, orphan.id, claims("g-3", "orphan@example.com"));
    expect(resolveGoogleUser(db, claims("g-3", "orphan@example.com"))).toEqual({ ok: false, reason: "no_workspace" });
  });
});
