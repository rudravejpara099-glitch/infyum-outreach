export type InstagramBrowserMode = "isolated" | "chrome_read_only";
export function browserModeAllowsJob(mode: InstagramBrowserMode, type: string): boolean {
  return mode !== "chrome_read_only" || type === "open_login";
}
export function browserModeAllowsLeadSearch(modes: InstagramBrowserMode[]): boolean {
  return modes.some((mode) => mode === "isolated");
}
