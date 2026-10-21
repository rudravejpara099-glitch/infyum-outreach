/** Quote CSV text and keep user-entered formulas inert in spreadsheet applications. */
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^(\s*[=+\-@]|[\t\r\n])/.test(text) ? "'" + text : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
