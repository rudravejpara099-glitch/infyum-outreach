import { z } from "zod";
import { PORTFOLIO_LINK } from "./prompts";

const partsSchema = z.object({ parts: z.array(z.string().trim().min(1).max(600)).min(1).max(3) });

/** Pulls the JSON out of the AI's answer, tolerating code fences or stray text around it. */
export function parseParts(raw: string): string[] {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI answer had no JSON");
  return partsSchema.parse(JSON.parse(raw.slice(start, end + 1))).parts;
}

const URL_RE = /https?:\/\/\S+/g;
const DASHES = /[—–]/;

// Stock lines and agency talk the owner has banned from first messages (phase1/GUIDE-FOR-CLAUDE.md, 4.4).
const BANNED_DM_PHRASES = /i hope (this|you)|i came across your profile|i'd love to connect|reaching out because|high-converting|lead generation machine|conversion-focused|white-label partner|are you interested\?/i;

/** Hard rules a draft must pass before it is stored. Returns a reason, or null when fine. `link` is the one link that may appear (or a list of allowed links). */
export function checkDraft(parts: string[], kind: "dm" | "reply" | "followup", link: string | string[] = PORTFOLIO_LINK): string | null {
  const allowed = (Array.isArray(link) ? link : [link]).map((l) => l.replace(/[.,)]+$/, ""));
  if (kind === "dm") {
    if (parts.length < 1 || parts.length > 3) return "A first DM must have one to three messages";
    const links = parts.flatMap((p) => p.match(URL_RE) ?? []).map((l) => l.replace(/[.,)!?]+$/, ""));
    if (links.length > 2) return "A first DM may contain at most two links";
    if (links.some((l) => !allowed.includes(l))) return `The only portfolio link allowed is ${allowed.join(" or ")}; do not use any other`;
    if (BANNED_DM_PHRASES.test(parts.join(" "))) return "Banned stock or agency phrasing; rewrite it in a plain human voice";
  } else if (kind === "followup" && parts.join(" ").match(URL_RE)) return "Follow-ups must not contain links";
  if (parts.some((p) => DASHES.test(p))) return "No dashes";
  if (/just checking in|circling back|touching base/i.test(parts.join(" "))) return "Filler follow-up phrasing";
  return null;
}
