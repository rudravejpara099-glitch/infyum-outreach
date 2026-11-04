import type { SheetGateway } from "./gateway";
import type { Cell, TabName, TabSpec } from "./model";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
type Fetcher = typeof fetch;

/** Column letter for a zero-based index (0 = A). Tabs here have far fewer than 26 columns. */
const col = (index: number) => String.fromCharCode(65 + index);
const range = (tab: string, a: string) => encodeURIComponent(`'${tab}'!${a}`);

/** The real Google Sheets door. `getToken` returns a Google access token with the spreadsheets scope for the signed-in team account
 * (service-account keys are blocked by an organization policy). Written against the public REST API; not yet run against a live sheet. */
export class GoogleSheetsGateway implements SheetGateway {
  constructor(private readonly spreadsheetId: string, private readonly getToken: () => Promise<string>, private readonly fetcher: Fetcher = fetch) {}

  private async call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${API}/${this.spreadsheetId}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { authorization: `Bearer ${await this.getToken()}`, "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!response.ok) throw new Error(`Google Sheets answered ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }

  async ensureWorkbook(tabs: TabSpec[]): Promise<void> {
    type SheetProps = { properties: { sheetId: number; title: string }; protectedRanges?: { range: { startRowIndex?: number } }[] };
    const meta = await this.call("?fields=sheets(properties(sheetId,title),protectedRanges(range))") as { sheets?: SheetProps[] };
    const existing = new Map((meta.sheets ?? []).map((s) => [s.properties.title, s]));
    const missing = tabs.filter((t) => !existing.has(t.name));
    if (missing.length) {
      const created = await this.call(":batchUpdate", { body: { requests: missing.map((t) => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } } })) } }) as { replies?: { addSheet: { properties: { sheetId: number; title: string } } }[] };
      for (const reply of created.replies ?? []) existing.set(reply.addSheet.properties.title, { properties: reply.addSheet.properties });
    }
    const requests: unknown[] = [];
    for (const tab of tabs) {
      const sheet = existing.get(tab.name)!;
      const sheetId = sheet.properties.sheetId;
      if (!(sheet.protectedRanges ?? []).some((p) => p.range.startRowIndex === 0)) {
        // Lock the header row so nobody renames a column by accident.
        requests.push({ addProtectedRange: { protectedRange: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, description: "Header row", warningOnly: false } } });
      }
      if (tab.dropdown) {
        requests.push({ setDataValidation: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 100_000, startColumnIndex: tab.dropdown.column, endColumnIndex: tab.dropdown.column + 1 },
          rule: { condition: { type: "ONE_OF_LIST", values: tab.dropdown.values.map((userEnteredValue) => ({ userEnteredValue })) }, strict: true, showCustomUi: true },
        } });
      }
    }
    if (requests.length) await this.call(":batchUpdate", { body: { requests } });
    // Headers are written every time, so a drifted header is repaired.
    await this.call("/values:batchUpdate", { body: { valueInputOption: "RAW", data: tabs.map((t) => ({ range: `'${t.name}'!A1:${col(t.headers.length - 1)}1`, values: [t.headers] })) } });
  }

  async readRows(tab: TabName): Promise<string[][]> {
    const result = await this.call(`/values/${range(tab, "A2:Z")}`) as { values?: string[][] };
    return result.values ?? [];
  }

  async upsertRows(tab: TabName, keyColumn: number, rows: Cell[][]): Promise<void> {
    if (rows.length === 0) return;
    const keyed = await this.call(`/values/${range(tab, `${col(keyColumn)}2:${col(keyColumn)}`)}`) as { values?: string[][] };
    const rowOf = new Map((keyed.values ?? []).map((v, i) => [String(v[0] ?? ""), i + 2]));
    const updates: { range: string; values: Cell[][] }[] = [];
    const fresh: Cell[][] = [];
    for (const row of rows) {
      const at = rowOf.get(String(row[keyColumn]));
      if (at) updates.push({ range: `'${tab}'!A${at}`, values: [row] }); else fresh.push(row);
    }
    if (updates.length) await this.call("/values:batchUpdate", { body: { valueInputOption: "USER_ENTERED", data: updates } });
    if (fresh.length) await this.appendRows(tab, fresh);
  }

  async appendRows(tab: TabName, rows: Cell[][]): Promise<void> {
    if (rows.length === 0) return;
    await this.call(`/values/${range(tab, "A1")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { body: { values: rows } });
  }
}
