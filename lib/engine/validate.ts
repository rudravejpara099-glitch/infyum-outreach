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

/** Hard rules a draft must pass before it is stored. Returns a reason, or null when fine. */
export function checkDraft(parts: string[], kind: "dm" | "reply" | "followup", link = PORTFOLIO_LINK): string | null {
  if (kind === "dm") {
    if (parts.length !== 3) return "A first DM must have exactly three messages";
    for (const [i, p] of parts.entries()) {
      const links = p.match(URL_RE) ?? [];
      if (i === 1 && !(links.length === 1 && links[0].replace(/[.,)]+$/, "") === link)) return "Message 2 must contain the portfolio link exactly once";
      if (i !== 1 && links.length > 0) return "Only message 2 may contain a link";
    }
  } else if (kind === "followup" && parts.join(" ").match(URL_RE)) return "Follow-ups must not contain links";
  if (parts.some((p) => DASHES.test(p))) return "No dashes";
  if (/just checking in|circling back|touching base/i.test(parts.join(" "))) return "Filler follow-up phrasing";
  return null;
}
