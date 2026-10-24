/** Only repeat interrupted tasks that do not write to Instagram or call paid providers. */
export function mayRecoverAfterCrash(type: string): boolean {
  return ["qualify", "check_inbox", "draft_reply"].includes(type);
}
