/** Input parsing only; qualification and contact rules remain in the domain/services. */
export const MAX_LEAD_FILE_BYTES = 500_000;
export function normalizeHandle(value: string): string | null {
  let handle = value.trim();
  if (/^https?:\/\//i.test(handle)) {
    try {
      const url = new URL(handle);
      if (!["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
      const match = /^\/([^/]+)\/?$/.exec(url.pathname);
      if (!match) return null;
      handle = match[1];
    } catch { return null; }
  }
  handle = handle.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) && ![".", ".."].includes(handle) ? handle : null;
}
export function parsePastedHandles(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean).map(value => value.replace(/^@/, "").toLowerCase());
}
const HEADERS = new Set(["username", "handle", "instagram", "instagram username", "instagram handle", "instagram url", "profile url"]);
/** Strict CSV with one clearly named handle column, or a single column without a header. */
export function parseLeadCsv(text: string): string[] {
  if (new TextEncoder().encode(text).length > MAX_LEAD_FILE_BYTES) throw new Error("Choose a CSV smaller than 500 KB.");
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell.trim()); cell = ""; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === ',') finishCell();
    else if (char === '\r' || char === '\n') { finishRow(); if (char === '\r' && text[index + 1] === '\n') index++; }
    else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("The CSV has invalid quotation marks. Export it again as CSV.");
      cell += char;
    }
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted value. Export it again as CSV.");
  finishRow();
  if (!rows.length) return [];
  const columns = rows[0].flatMap((value, index) => HEADERS.has(value.toLowerCase().replace(/[_-]+/g, " ")) ? [index] : []);
  if (columns.length > 1 || (!columns.length && rows[0].length !== 1)) throw new Error("Include one column named username, handle or Instagram URL.");
  const width = rows[0].length;
  if (rows.some(values => values.length !== width)) throw new Error("Some CSV rows have missing or extra columns. Export it again as CSV.");
  return (columns.length ? rows.slice(1) : rows).map(values => values[columns[0] ?? 0]).filter(Boolean);
}
