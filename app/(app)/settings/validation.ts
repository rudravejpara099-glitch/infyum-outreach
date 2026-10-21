import { z } from "zod";
export const teammateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100, "Keep the name under 100 characters."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for the password.").max(200, "Use a password under 200 characters."),
});
export const handleSchema = z.string().trim().regex(/^@?[A-Za-z0-9._]{1,30}$/, "Enter an Instagram handle, using letters, numbers, dots or underscores.");
export function supportedTimeZones(): string[] { return ["UTC", ...Intl.supportedValuesOf("timeZone")]; }
export function validTimeZone(value: string): boolean {
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    return value === value.trim() && (canonical === "UTC" || Intl.supportedValuesOf("timeZone").includes(canonical));
  } catch { return false; }
}
export function validCap(value: string): boolean {
  return value === "" || (/^\d{1,9}(\.\d{1,6})?$/.test(value) && Number.isFinite(Number(value)));
}
