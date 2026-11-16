// Public sign-up (/register) is CLOSED unless the owner turns it on with ALLOW_REGISTRATION=true.
// Why: the app is reachable from the internet, and /register creates an account and a workspace for anyone
// who finds the address (no approval, no cap, no email check). Team invitations (/join) and the very first
// account (/setup, only while there are no users) are not affected.
// Read at request time, not import time, so changing the setting needs a restart but not a rebuild.
export const REGISTRATION_CLOSED_MESSAGE = "Sign-up is closed. Ask the owner of your workspace for an invitation.";

export function registrationOpen(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env.ALLOW_REGISTRATION ?? "").trim());
}
