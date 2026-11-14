import { z } from "zod";

const partsSchema = z.object({ parts: z.array(z.string().trim().min(1).max(900)).min(1).max(3) });
const dmResultSchema = z.union([
  z.object({ skip: z.literal(true), reason: z.string().trim().min(1).max(300) }),
  z.object({ skip: z.literal(false).optional(), parts: z.array(z.string().trim().min(1).max(900)).length(1), profile: z.string().trim().max(400).default(""), why: z.string().trim().max(1200).default(""), flags: z.string().trim().max(600).default(""), followup: z.string().trim().max(900).default("") }),
]);
export type DmResult = { skip: true; reason: string } | { skip: false; parts: string[]; profile: string; why: string; flags: string; followup: string };

/** First-DM answer: either SKIP with a reason, or one DM plus the short "why this angle" and flags notes. */
export function parseDmResult(raw: string): DmResult {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI answer had no JSON");
  const r = dmResultSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  return r.skip === true ? { skip: true, reason: r.reason } : { skip: false, parts: r.parts, profile: r.profile, why: r.why, flags: r.flags, followup: r.followup };
}

/** Pulls the JSON out of the AI's answer, tolerating code fences or stray text around it. */
export function parseParts(raw: string): string[] {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI answer had no JSON");
  return partsSchema.parse(JSON.parse(raw.slice(start, end + 1))).parts;
}

const URL_RE = /https?:\/\/\S+/g;
const DASHES = /[—–]/;

/** Hard rules a draft must pass before it is stored. Returns a reason, or null when fine. */
export function checkDraft(parts: string[], kind: "dm" | "reply" | "followup"): string | null {
  if (kind === "dm") {
    if (parts.length !== 1) return "A first DM must be exactly one message";
    if ((parts[0].match(URL_RE) ?? []).length > 0) return "A first DM must not contain a link";
    const words = parts[0].trim().split(/\s+/).length;
    if (words < 30 || words > 140) return `A first DM should be about 50 to 110 words, this one has ${words}`;
  } else if (kind === "followup" && parts.join(" ").match(URL_RE)) return "Follow-ups must not contain links";
  if (kind === "reply" && parts.some((p) => DASHES.test(p))) return "No dashes";
  if (/just checking in|circling back|touching base/i.test(parts.join(" "))) return "Filler follow-up phrasing";
  return null;
}
