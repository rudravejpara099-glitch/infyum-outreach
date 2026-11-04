import type { Cell, TabName, TabSpec } from "./model";

/** The only door to Google Sheets. Nothing else in the app talks to the Sheets API (build plan: one module). */
export interface SheetGateway {
  /** Creates any missing tab with its header row, locks the header row, and sets dropdowns. Safe to call again. */
  ensureWorkbook(tabs: TabSpec[]): Promise<void>;
  /** All rows under the header, as text. */
  readRows(tab: TabName): Promise<string[][]>;
  /** Updates the row whose key column matches, or adds it. Writing the same rows twice changes nothing. */
  upsertRows(tab: TabName, keyColumn: number, rows: Cell[][]): Promise<void>;
  /** Adds rows at the end. */
  appendRows(tab: TabName, rows: Cell[][]): Promise<void>;
}
