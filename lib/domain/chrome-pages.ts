export type ChromePage = { id: number; url: string };
type PageResult = { structuredContent?: { pages?: unknown }; content?: { type: string; text?: string }[] };

/** Tab titles are optional in Chrome's documented response, including during loading. */
export function chromePages(result: PageResult): ChromePage[] {
  if (Array.isArray(result.structuredContent?.pages)) {
    return result.structuredContent.pages.flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      return Number.isSafeInteger(row.id) && Number(row.id) >= 0 && typeof row.url === "string" ? [{ id: Number(row.id), url: row.url }] : [];
    });
  }
  const text = (result.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
  return text.split("\n").flatMap(line => {
    const row = /^\s*(\d+):\s*(.+)$/.exec(line);
    if (!row || !Number.isSafeInteger(Number(row[1]))) return [];
    const label = row[2].replace(/\s+isolatedContext=\S+$/, "").replace(/\s+\[selected\]$/, "").trim();
    const url = /^https?:\/\//.test(label) ? label.split(/\s/)[0] : /\((https?:\/\/.*)\)$/.exec(label)?.[1];
    return url ? [{ id: Number(row[1]), url }] : [];
  });
}

/** Only an empty splash page is eligible for one read-only resource reload. */
export function chromeProfileNeedsReload(state: { loggedIn: boolean; text: string }): boolean {
  return !state.loggedIn && state.text.trim().length === 0;
}
