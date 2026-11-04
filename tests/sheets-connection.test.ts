import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { newFlow } from "@/lib/auth/google";
import { exchangeSheetsCode, openSecret, refreshSheetsToken, sealSecret, SHEETS_SCOPE, sheetsAuthorizationUrl } from "@/lib/sheets/oauth";
import { createTeamSheet, disconnectSheets, getSheetGateway, saveRefreshToken, sheetIdFromInput, sheetsStatus, tokenProvider } from "@/lib/sheets/connection";

const creds = { clientId: "cid", clientSecret: "csecret", sessionSecret: "s".repeat(40) };
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBc";
let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());

type Answer = { ok?: boolean; body: unknown };
function fakeFetch(answers: Answer[]) {
  const calls: { url: string; body: string; auth: string | null }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ""), auth: new Headers(init?.headers).get("authorization") });
    const a = answers.shift() ?? { ok: false, body: {} };
    return { ok: a.ok ?? true, status: a.ok === false ? 500 : 200, json: async () => a.body } as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("authorization", () => {
  it("asks for the spreadsheets scope only, offline, with a consent screen and PKCE", () => {
    const url = new URL(sheetsAuthorizationUrl({ clientId: "cid", redirectUri: "http://localhost:3000/api/sheets/google/callback", flow: newFlow("link") }));
    expect(url.searchParams.get("scope")).toBe(SHEETS_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/sheets/google/callback");
  });
  it("keeps the refresh token only when Google returns one together with the Sheets scope", async () => {
    const base = { code: "c", verifier: "v", clientId: "cid", clientSecret: "x", redirectUri: "r", now: () => 1000 };
    const ok = fakeFetch([{ body: { access_token: "a", refresh_token: "r1", expires_in: 100, scope: `openid ${SHEETS_SCOPE}` } }]);
    await expect(exchangeSheetsCode({ ...base, fetchImpl: ok.fn as never })).resolves.toEqual({ refreshToken: "r1", accessToken: "a", expiresAt: 101_000 });
    for (const body of [{ access_token: "a", scope: SHEETS_SCOPE }, { access_token: "a", refresh_token: "r", scope: "openid" }, {}]) {
      await expect(exchangeSheetsCode({ ...base, fetchImpl: fakeFetch([{ body }]).fn as never })).rejects.toThrow();
    }
    await expect(exchangeSheetsCode({ ...base, fetchImpl: fakeFetch([{ ok: false, body: {} }]).fn as never })).rejects.toThrow("did not accept");
  });
  it("renews an access token from the refresh token, and says so plainly when Google refuses", async () => {
    const f = fakeFetch([{ body: { access_token: "new", expires_in: 3600 } }]);
    await expect(refreshSheetsToken({ refreshToken: "r", clientId: "cid", clientSecret: "x", fetchImpl: f.fn as never, now: () => 0 })).resolves.toEqual({ accessToken: "new", expiresAt: 3_600_000 });
    expect(f.calls[0].body).toContain("grant_type=refresh_token");
    await expect(refreshSheetsToken({ refreshToken: "r", clientId: "cid", clientSecret: "x", fetchImpl: fakeFetch([{ ok: false, body: {} }]).fn as never })).rejects.toThrow("Connect it again");
  });
});

describe("stored token", () => {
  it("is encrypted at rest, opens only with the same secret, and detects tampering", () => {
    const sealed = sealSecret("refresh-token-123", creds.sessionSecret);
    expect(sealed).not.toContain("refresh-token-123");
    expect(openSecret(sealed, creds.sessionSecret)).toBe("refresh-token-123");
    expect(openSecret(sealed, "x".repeat(40))).toBeNull();
    expect(openSecret(sealed.slice(0, -2) + "AA", creds.sessionSecret)).toBeNull();
    expect(openSecret("garbage", creds.sessionSecret)).toBeNull();
    expect(sealSecret("same", creds.sessionSecret)).not.toBe(sealSecret("same", creds.sessionSecret));
  });
  it("never keeps the plain token in the settings table", () => {
    saveRefreshToken(db, "plain-token-xyz", creds.sessionSecret);
    expect(JSON.stringify(db.prepare("SELECT * FROM settings").all())).not.toContain("plain-token-xyz");
  });
});

describe("connection", () => {
  it("reads a Sheet id from a bare id or a link and rejects anything else", () => {
    expect(sheetIdFromInput(ID)).toBe(ID);
    expect(sheetIdFromInput(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    for (const bad of ["", "short", "https://example.com/x", "has spaces in it 1234567890123456"]) expect(sheetIdFromInput(bad)).toBeNull();
  });
  it("gives out a token, reuses it until a minute before it expires, then renews it", async () => {
    saveRefreshToken(db, "rt", creds.sessionSecret);
    const f = fakeFetch([{ body: { access_token: "t1", expires_in: 3600 } }, { body: { access_token: "t2", expires_in: 3600 } }]);
    let now = 0;
    const token = tokenProvider(db, creds, f.fn, () => now);
    expect(await token()).toBe("t1");
    now = 3_000_000; expect(await token()).toBe("t1");
    now = 3_550_000; expect(await token()).toBe("t2");
    expect(f.calls).toHaveLength(2);
  });
  it("refuses to renew when nothing is connected", async () => {
    await expect(tokenProvider(db, creds, fakeFetch([]).fn)()).rejects.toThrow("not connected");
  });
  it("has a gateway only when a Sheet, a token and the Google client are all there", () => {
    expect(getSheetGateway(db, creds)).toBeNull();
    saveRefreshToken(db, "rt", creds.sessionSecret);
    expect(getSheetGateway(db, creds)).toBeNull();
    setSetting(db, "sheet_id", ID);
    expect(getSheetGateway(db, creds)).not.toBeNull();
    expect(getSheetGateway(db, { ...creds, clientSecret: "" })).toBeNull();
  });
  it("creates the team Sheet, remembers its id and forgets old sync marks", async () => {
    saveRefreshToken(db, "rt", creds.sessionSecret);
    setSetting(db, "sheet_schema", "1"); setSetting(db, "sheet_activity_synced_id", "9");
    const f = fakeFetch([{ body: { access_token: "t", expires_in: 3600 } }, { body: { spreadsheetId: ID, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit` } }]);
    const sheet = await createTeamSheet(db, creds, f.fn);
    expect(sheet.id).toBe(ID);
    expect(getSetting(db, "sheet_id")).toBe(ID);
    expect(getSetting(db, "sheet_schema")).toBeNull();
    expect(getSetting(db, "sheet_activity_synced_id")).toBeNull();
    expect(f.calls[1].auth).toBe("Bearer t");
    expect(f.calls[1].body).toContain("INFYUM Outreach Database");
  });
  it("reports a failed creation without saving anything", async () => {
    saveRefreshToken(db, "rt", creds.sessionSecret);
    const f = fakeFetch([{ body: { access_token: "t", expires_in: 3600 } }, { ok: false, body: {} }]);
    await expect(createTeamSheet(db, creds, f.fn)).rejects.toThrow("creating the Sheet");
    expect(getSetting(db, "sheet_id")).toBeNull();
  });
  it("shows its status and can be disconnected, leaving other settings alone", () => {
    saveRefreshToken(db, "rt", creds.sessionSecret);
    setSetting(db, "sheet_id", ID); setSetting(db, "sheet_sync_error", "Sheets API unavailable"); setSetting(db, "portfolio_link", "https://x.test");
    expect(sheetsStatus(db)).toEqual({ connected: true, sheetId: ID, syncedAt: null, error: "Sheets API unavailable" });
    disconnectSheets(db);
    expect(sheetsStatus(db)).toEqual({ connected: false, sheetId: null, syncedAt: null, error: null });
    expect(getSetting(db, "portfolio_link")).toBe("https://x.test");
  });
});
