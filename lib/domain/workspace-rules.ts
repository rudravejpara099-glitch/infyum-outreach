/** Company names are plain display text with a small, predictable size limit. */
export function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && !/[\u0000-\u001f\u007f]/.test(email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** A form opened in one company must never mutate a subsequently selected company. */
export function workspaceFormMatches(activeId: string, submitted: unknown): boolean {
  return typeof submitted === "string" && submitted === activeId;
}

/** The owner's already signed-in browser belongs only to the original team. */
export function hostChromeAllowed(workspaceId: string): boolean {
  return workspaceId === "legacy";
}

/** Explicit empty overrides prevent local .env loading from restoring the host's secrets. */
export function workspaceWorkerEnv(env: NodeJS.ProcessEnv, allowHostChrome: boolean): NodeJS.ProcessEnv {
  const result = { ...env };
  if (!allowHostChrome) {
    for (const key of ["ANTHROPIC_API_KEY", "APIFY_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "BILLING_OWNER_USER_ID", "SESSION_SECRET"]) result[key] = "";
  }
  return result;
}
