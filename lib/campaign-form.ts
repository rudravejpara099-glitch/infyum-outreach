import { z } from "zod";
import type { CampaignInput } from "@/lib/db/repos/campaigns";

export const NICHE_OPTIONS = ["General", "Business coach", "Credit repair", "Business credit and funding", "Tax and CPA", "Bookkeeping"] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name"),
  audienceText: z.string().trim().max(2000).default(""),
  country: z.string().trim().min(1).default("United States"),
  minFollowers: z.coerce.number().int().min(0),
  maxFollowers: z.coerce.number().int().min(1),
  bookingLink: z.string().trim().refine((v) => v === "" || /^https?:\/\//.test(v), "Booking link must start with http:// or https://"),
}).refine((v) => v.minFollowers <= v.maxFollowers, { message: "Minimum followers cannot be above the maximum", path: ["minFollowers"] });

export function parseCampaignForm(form: FormData): { input: CampaignInput; accountIds: number[] } {
  const base = schema.parse(Object.fromEntries(form));
  const extra = String(form.get("nicheOther") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const niches = [...form.getAll("niches").map(String), ...extra];
  return {
    input: { ...base, niches, approvalRequired: form.get("approvalRequired") === "on", followupsEnabled: form.get("followupsEnabled") === "on" },
    accountIds: form.getAll("accountIds").map(Number).filter(Number.isFinite),
  };
}
