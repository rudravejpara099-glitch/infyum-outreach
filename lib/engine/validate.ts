import { z } from "zod";

const partsSchema = z.object({ parts: z.array(z.string().trim().min(1).max(900)).min(1).max(3) });
const dmResultSchema = z.union([
  z.object({ skip: z.literal(true), reason: z.string().trim().min(1).max(300) }),
  z.object({ skip: z.literal(false).optional(), parts: z.array(z.string().trim().min(1).max(900)).length(1), profile: z.string().trim().max(400).default(""), why: z.string().trim().max(1200).default(""), flags: z.string().trim().max(600).default(""), followup: z.string().trim().max(900).default(""), teachesMarketing: z.boolean().default(false) }),
]);
export type DmResult = { skip: true; reason: string } | { skip: false; parts: string[]; profile: string; why: string; flags: string; followup: string; teachesMarketing: boolean };

/** First-DM answer: either SKIP with a reason, or one DM plus the short "why this angle" and flags notes. */
export function parseDmResult(raw: string): DmResult {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI answer had no JSON");
  const r = dmResultSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  return r.skip === true ? { skip: true, reason: r.reason } : { skip: false, parts: r.parts, profile: r.profile, why: r.why, flags: r.flags, followup: r.followup, teachesMarketing: r.teachesMarketing };
}

/** Pulls the JSON out of the AI's answer, tolerating code fences or stray text around it. */
export function parseParts(raw: string): string[] {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI answer had no JSON");
  return partsSchema.parse(JSON.parse(raw.slice(start, end + 1))).parts;
}

const URL_RE = /https?:\/\/\S+/g;
const DASHES = /[—–]/;

export type DraftContext = { notes?: string; teachesMarketing?: boolean };

const SELLING_DEFENCE = /\b(no pitch|not a pitch|no strings|not selling|not trying to sell|hope you'?re (doing )?well|hope this finds)\b/i;
const MARKETING_ADVICE = /\b(you should|you need to|you could|you might want to|i'?d recommend|i would recommend|would carry|more social proof|your conversion|your funnel|your landing page|should add)\b/i;
const NOT_DETAILS = new Set(["INFYUM", "Sunil", "Loom", "Instagram", "IG", "DM", "US", "USA"]);

/** Capitalised words and numbers in the DM that are not the first word of a sentence: names, events, offers, figures. */
function specifics(dm: string): string[] {
  const out: string[] = [];
  for (const sentence of dm.replace(/^\s*(hey|hi|hello)\s+/i, "").split(/(?<=[.!?:])\s+|\n+/)) {
    for (const word of sentence.trim().split(/\s+/).slice(1)) {
      const w = word.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%K]+$/gu, "");
      if (w.length >= 3 && !NOT_DETAILS.has(w) && (/^\p{Lu}[\p{L}\p{N}'-]*$/u.test(w) || /^\$?\d/.test(w))) out.push(w.toLowerCase());
    }
  }
  return out;
}

/** Hard rules a draft must pass before it is stored. Returns a reason, or null when fine. */
export function checkDraft(parts: string[], kind: "dm" | "reply" | "followup", ctx: DraftContext = {}): string | null {
  if (kind === "dm") {
    if (parts.length !== 1) return "A first DM must be exactly one message";
    if ((parts[0].match(URL_RE) ?? []).length > 0) return "A first DM must not contain a link";
    const words = parts[0].trim().split(/\s+/).length;
    if (words < 30 || words > 140) return `A first DM should be about 50 to 110 words, this one has ${words}`;
    const dm = parts[0];
    if (!dm.includes("?")) return "A first DM must ask one easy question (the soft offer counts as a question, like \"Want me to show you?\")";
    if (SELLING_DEFENCE.test(dm)) return "Do not say \"no pitch\", \"no strings\" or open with pleasantries; it sounds like a pitch. Just say what you noticed";
    if (ctx.notes && ctx.notes.length > 120) {
      const notes = ctx.notes.toLowerCase();
      if (!specifics(dm).some((s) => notes.includes(s))) return "The DM names no specific detail from their profile (a post, event, offer, quote or figure). Open with one you actually saw";
    }
    if (ctx.teachesMarketing) {
      if (MARKETING_ADVICE.test(dm)) return "They teach marketing or sales: never advise them or critique their funnel. Ask one genuine question about one specific thing, or suggest a partnership where INFYUM builds the pages and sequences for their community";
      if (!/\bpartner/i.test(dm) && !dm.includes("?")) return "They teach marketing or sales: ask a genuine question or suggest a partnership";
    }
  } else if (kind === "followup" && parts.join(" ").match(URL_RE)) return "Follow-ups must not contain links";
  if (kind === "reply" && parts.some((p) => DASHES.test(p))) return "No dashes";
  if (/just checking in|circling back|touching base/i.test(parts.join(" "))) return "Filler follow-up phrasing";
  return null;
}
