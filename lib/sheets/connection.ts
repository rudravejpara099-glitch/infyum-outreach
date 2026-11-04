import type { Db } from "@/lib/db/core";
import { getSetting, setSetting } from "@/lib/db/repos/settings";
import { GoogleSheetsGateway } from "./google";
import { openSecret, refreshSheetsToken, sealSecret } from "./oauth";

type Fetch = typeof fetch;
export type SheetsCredentials = { clientId: string; clientSecret: string; sessionSecret: string };

export const SHEET_TITLE = "INFYUM Outreach Database";
const SHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;

export const validSheetId = (value: string) => SHEET_ID.test(value);
/** Accepts a bare id or a full docs.google.com link and returns the id. */
export function sheetIdFromInput(value: string): string | null {
  const text = value.trim();
  const fromLink = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  const id = fromLink ?? text;
  return validSheetId(id) ? id : null;
}

export function saveRefreshToken(db: Db, refreshToken: string, sessionSecret: string): void {
  setSetting(db, "sheet_refresh_token", sealSecret(refreshToken, sessionSecret));
}
export function disconnectSheets(db: Db): void {
  db.prepare("DELETE FROM settings WHERE key IN ('sheet_refresh_token','sheet_id','sheet_schema','sheet_synced_at','sheet_sync_tried_at','sheet_cycle_at','sheet_sync_error','sheet_activity_synced_id','sheet_stage_seen')").run();
}
export type SheetsStatus = { connected: boolean; sheetId: string | null; syncedAt: string | null; error: string | null };
export function sheetsStatus(db: Db): SheetsStatus {
  const sheetId = getSetting(db, "sheet_id");
  return { connected: !!getSetting(db, "sheet_refresh_token"), sheetId, syncedAt: getSetting(db, "sheet_synced_at"), error: getSetting(db, "sheet_sync_error") || null };
}

/** A function that returns a fresh access token, renewing it a minute before it expires. */
export function tokenProvider(db: Db, creds: SheetsCredentials, fetchImpl?: Fetch, now: () => number = Date.now): () => Promise<string> {
  let cached: { accessToken: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.accessToken;
    const sealed = getSetting(db, "sheet_refresh_token");
    const refreshToken = sealed ? openSecret(sealed, creds.sessionSecret) : null;
    if (!refreshToken) throw new Error("Google Sheets is not connected. Connect it in Settings.");
    cached = await refreshSheetsToken({ refreshToken, clientId: creds.clientId, clientSecret: creds.clientSecret, fetchImpl: fetchImpl as never, now });
    return cached.accessToken;
  };
}

/** The gateway for this workspace, or null when no Sheet is set up yet. */
export function getSheetGateway(db: Db, creds: SheetsCredentials, fetchImpl?: Fetch): GoogleSheetsGateway | null {
  const sheetId = getSetting(db, "sheet_id");
  if (!sheetId || !getSetting(db, "sheet_refresh_token") || !creds.clientId || !creds.clientSecret) return null;
  return new GoogleSheetsGateway(sheetId, tokenProvider(db, creds, fetchImpl), fetchImpl);
}

/** Makes a new, empty spreadsheet in the connected Google account and remembers its id. */
export async function createTeamSheet(db: Db, creds: SheetsCredentials, fetchImpl: Fetch = fetch): Promise<{ id: string; url: string }> {
  const token = await tokenProvider(db, creds, fetchImpl)();
  const response = await fetchImpl("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ properties: { title: SHEET_TITLE } }),
  });
  if (!response.ok) throw new Error(`Google Sheets answered ${response.status} when creating the Sheet.`);
  const body = await response.json() as { spreadsheetId?: unknown; spreadsheetUrl?: unknown };
  if (typeof body.spreadsheetId !== "string" || !validSheetId(body.spreadsheetId)) throw new Error("Google did not return a usable Sheet.");
  setSetting(db, "sheet_id", body.spreadsheetId);
  // A new Sheet needs its tabs created on the first sync.
  db.prepare("DELETE FROM settings WHERE key IN ('sheet_schema','sheet_activity_synced_id','sheet_stage_seen')").run();
  return { id: body.spreadsheetId, url: typeof body.spreadsheetUrl === "string" ? body.spreadsheetUrl : `https://docs.google.com/spreadsheets/d/${body.spreadsheetId}/edit` };
}
