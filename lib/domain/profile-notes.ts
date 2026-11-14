// Pure helpers for the "what we saw" notes the DM writer reads. No browser, no network.
export type PostSeen = { caption: string; date?: string; location?: string };
export type ProfileSeen = {
  /** Text of the profile header: name line, bio, counts. */
  header: string;
  /** Top of the profile page text: usually includes the highlight titles. */
  pageTop?: string;
  /** Every outgoing link found in the header (already decoded). */
  links?: string[];
  posts?: PostSeen[];
  /** Auto image descriptions, a fallback when no captions could be read. */
  alts?: string[];
};

const clean = (s: string, max: number) => s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

/** Instagram wraps outgoing links as l.instagram.com/?u=<encoded target>. Returns the real target, or null for Instagram's own links. */
export function decodeBioLink(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.hostname === "l.instagram.com") {
      const target = url.searchParams.get("u");
      return target && /^https?:\/\//i.test(target) ? target : null;
    }
    if (/(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)cdninstagram\.com$/i.test(url.hostname)) return null;
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

/** The one link a prospect puts in their bio, if the header shows any. */
export function pickBioLink(hrefs: string[]): string | null {
  for (const href of hrefs) { const real = decodeBioLink(href); if (real) return real; }
  return null;
}

export function formatProfileNotes(seen: ProfileSeen): string {
  const sections: string[] = [`Profile header (name line, bio, counts):\n${clean(seen.header, 1200)}`];
  const link = pickBioLink(seen.links ?? []);
  if (link) sections.push(`Bio link URL: ${link}`);
  if (seen.pageTop && clean(seen.pageTop, 4000) !== clean(seen.header, 4000)) sections.push(`Rest of the top of the profile (highlight titles, tabs):\n${clean(seen.pageTop, 1000)}`);
  const posts = (seen.posts ?? []).filter((p) => p.caption.trim());
  if (posts.length) sections.push(`Recent posts (caption text):\n${posts.map((p) => `- ${[p.date, p.location && `at ${p.location}`].filter(Boolean).join(", ")}${p.date || p.location ? ": " : ""}${clean(p.caption, 700)}`).join("\n")}`);
  else if (seen.alts?.length) sections.push(`Recent posts (image descriptions only, no captions could be read):\n- ${seen.alts.slice(0, 8).join("\n- ")}`);
  return sections.join("\n\n");
}

/** The bio link line written by formatProfileNotes, for the service that opens the page. */
export function bioLinkFromNotes(notes: string): string | null {
  return notes.match(/^Bio link URL: (https?:\/\/\S+)$/m)?.[1] ?? null;
}

/** Cheap checks before any request leaves the machine. DNS is checked separately by the fetcher. */
export function isSafeBioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return false; // raw IPs are never a coach's bio link
    return true;
  } catch { return false; }
}
