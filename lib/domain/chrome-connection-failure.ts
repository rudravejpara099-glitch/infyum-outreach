const messages = {
  macos: "macOS blocked access to Chrome’s connection file. Allow the app’s Chrome-file access in macOS settings, then retry.",
  closed: "Chrome’s debugging connection is closed. Reopen your signed-in Chrome profile and retry its connection check.",
  missing: "Chrome’s debugging connection file is missing. Enable remote debugging in your signed-in Chrome profile, then retry.",
  disconnected: "Chrome disconnected during the check. Reopen the signed-in profile and retry.",
  permission: "Chrome denied the connection. If Chrome shows a permission prompt, allow this session and retry.",
  unavailable: "Chrome’s connection is unavailable. Check that the signed-in profile is open and its debugging connection is enabled, then retry.",
} as const;

/** Classify the underlying cause before its generic wrapper; never return provider text, paths or tokens. */
export function chromeConnectionFailure(details: string): string | null {
  if (Object.values(messages).some(message => message === details)) return details;
  if (/EPERM|EACCES|operation not permitted|macOS blocked/i.test(details)) return messages.macos;
  if (/ECONNREFUSED|connection refused/i.test(details)) return messages.closed;
  if (/ENOENT|could not find DevToolsActivePort|connection file is missing/i.test(details)) return messages.missing;
  if (/ECONNRESET|socket hang up|browser disconnected/i.test(details)) return messages.disconnected;
  if (/\b403\b|remote debugging permission was denied/i.test(details)) return messages.permission;
  if (/remote debugging|DevToolsActivePort|could not connect to Chrome/i.test(details)) return messages.unavailable;
  return null;
}

/**
 * True for errors that mean Chrome could not be reached at all. They happen before any page action,
 * so the work can wait and run again once Chrome is reachable.
 */
export function isChromeUnreachable(message: string): boolean {
  return (Object.values(messages) as string[]).includes(message) || message === "Chrome could not list its open pages."
    || /^Chrome did not finish connecting\b/.test(message);
}
