import type { SheetGateway } from "@/lib/sheets/gateway";
import type { Cell, TabName, TabSpec } from "@/lib/sheets/model";

/** An in-memory stand-in for Google Sheets, with the behaviours the real one has: header row, upsert by key, append. */
export class FakeSheetGateway implements SheetGateway {
  tabs = new Map<string, { spec: TabSpec; rows: string[][] }>();
  calls: string[] = [];
  /** Make the next N calls fail, to prove a failure never breaks outreach and is retried. */
  failNext = 0;
  /** Fail once on the first call whose name starts with this, e.g. "append:Activity Log". */
  failOnce: string | null = null;
  private maybeFail(call: string) {
    this.calls.push(call);
    if (this.failOnce && call.startsWith(this.failOnce)) { this.failOnce = null; throw new Error("Sheets API unavailable"); }
    if (this.failNext > 0) { this.failNext--; throw new Error("Sheets API unavailable"); }
  }
  async ensureWorkbook(tabs: TabSpec[]) {
    this.maybeFail("ensure");
    for (const spec of tabs) if (!this.tabs.has(spec.name)) this.tabs.set(spec.name, { spec, rows: [] });
  }
  private tab(name: TabName) { const t = this.tabs.get(name); if (!t) throw new Error(`No tab ${name}`); return t; }
  async readRows(name: TabName) { this.maybeFail(`read:${name}`); return this.tab(name).rows.map((r) => [...r]); }
  async upsertRows(name: TabName, key: number, rows: Cell[][]) {
    this.maybeFail(`upsert:${name}`);
    const t = this.tab(name);
    for (const row of rows) {
      const text = row.map(String);
      const at = t.rows.findIndex((r) => r[key] === text[key]);
      if (at >= 0) t.rows[at] = text; else t.rows.push(text);
    }
  }
  async appendRows(name: TabName, rows: Cell[][]) { this.maybeFail(`append:${name}`); this.tab(name).rows.push(...rows.map((r) => r.map(String))); }
}
