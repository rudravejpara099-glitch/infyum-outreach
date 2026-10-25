export type InstagramBrowserMode = "isolated" | "chrome_read_only";
export function browserModeAllowsJob(mode: InstagramBrowserMode, type: string): boolean {
  return mode !== "chrome_read_only" || ["open_login", "qualify", "warmup", "draft_dm", "draft_followup", "check_inbox", "send"].includes(type);
}
export function browserModeAllowsLeadSearch(modes: InstagramBrowserMode[]): boolean {
  return modes.some((mode) => mode === "isolated");
}
export function loginCheckFailure(message: string): string {
  if (/warning|human check|captcha/i.test(message)) return "Instagram needs you to review a warning or verification in Chrome. The app stopped the check.";
  if (/403|remote debugging|DevToolsActivePort|Could not connect to Chrome/i.test(message)) return "Chrome could not start the approved connection. If Chrome shows a permission prompt, allow this session and try again.";
  if (/timed out|timeout|took too long/i.test(message)) return "Instagram took too long to respond. Check that Instagram loads in Chrome, then try again from Accounts.";
  if (/not confirmed|sign-in is not confirmed/i.test(message)) return "Instagram is not signed in to this account in Chrome.";
  return "The sign-in check could not finish. Try again from Accounts.";
}
