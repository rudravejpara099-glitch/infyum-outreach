import { z } from "zod";
import { config } from "@/lib/config";
export const accountIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const capSchema = z.coerce.number().int().min(1).max(config.absoluteDailyCeiling);
export const connectSchema = z.object({
  handle: z.string().trim().regex(/^@?[a-zA-Z0-9._]{1,30}$/, "Enter a valid Instagram handle.")
    .refine(value => ![".", ".."].includes(value.replace(/^@/, "")), "Enter a valid Instagram handle."),
  dailyCap: capSchema,
  browserMode: z.enum(["isolated", "chrome_read_only"]).default("isolated"),
});
