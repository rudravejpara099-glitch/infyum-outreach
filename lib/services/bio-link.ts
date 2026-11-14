// Reads the public page behind a prospect's bio link, so the writer can see the funnel (freebies,
// booking pages, offers), not only the posts. Read-only, one GET at a time, with strict limits.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { bioLinkFromNotes, isSafeBioUrl } from "@/lib/domain/profile-notes";

const MAX_BYTES = 600_000, MAX_REDIRECTS = 3, TIMEOUT_MS = 8_000;

export type BioFetch = (url: string, signal: AbortSignal) => Promise<{ status: number; location: string | null; contentType: string; text: () => Promise<string> }>;

function privateAddress(address: string): boolean {
  if (isIP(address) === 6) return /^(::1?$|fc|fd|fe80|::ffff:)/i.test(address);
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

async function hostIsPublic(host: string): Promise<boolean> {
  try { return (await lookup(host, { all: true })).every((r) => !privateAddress(r.address)); } catch { return false; }
}

const defaultFetch: BioFetch = async (url, signal) => {
  const res = await fetch(url, { signal, redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; INFYUM-outreach-reader)", accept: "text/html" } });
  return { status: res.status, location: res.headers.get("location"), contentType: res.headers.get("content-type") ?? "", text: async () => (await res.text()).slice(0, MAX_BYTES) };
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Title, description, link labels and visible text of a page, capped. Exported for tests. */
export function summarizeHtml(html: string): string {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const meta = (name: string) => decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1] ?? "").trim();
  const description = meta("og:description") || meta("description");
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ");
  const labels = [...new Set([...body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1])).filter((t) => t.length > 1 && t.length < 90))].slice(0, 25);
  const text = strip(body).slice(0, 1200);
  return [title && `Title: ${title}`, description && `Description: ${description.slice(0, 300)}`, labels.length && `Link labels on the page: ${labels.join(" | ")}`, text && `Visible text: ${text}`].filter(Boolean).join("\n");
}

/** Returns a short summary of the bio link page, or "" when it cannot be read safely. Never throws. */
export async function readBioLinkPage(url: string, fetcher: BioFetch = defaultFetch, publicHost: (host: string) => Promise<boolean> = hostIsPublic): Promise<string> {
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isSafeBioUrl(current) || !(await publicHost(new URL(current).hostname))) return "";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetcher(current, controller.signal);
        if (res.status >= 300 && res.status < 400 && res.location) { current = new URL(res.location, current).toString(); continue; }
        if (res.status < 200 || res.status >= 300 || !/html|text/i.test(res.contentType)) return "";
        return summarizeHtml(await res.text());
      } finally { clearTimeout(timer); }
    }
    return "";
  } catch { return ""; }
}

/** Adds the bio link page to the notes when the profile showed a bio link. Notes are returned unchanged otherwise. */
export async function withBioLinkPage(notes: string, fetcher?: BioFetch, publicHost?: (host: string) => Promise<boolean>): Promise<string> {
  const link = bioLinkFromNotes(notes);
  if (!link) return notes;
  const page = await readBioLinkPage(link, fetcher, publicHost);
  return page ? `${notes}\n\nWhat the bio link page shows (${new URL(link).hostname}):\n${page}` : `${notes}\n\n(The bio link page could not be read.)`;
}
