type AccountState = "active" | "paused" | "blocked";

const SIGN_IN_REQUIRED = /not signed in|not logged in|sign-in is not confirmed|sign-in was not completed/i;

export function accountNeedsSignIn(statusNote: string): boolean {
  return SIGN_IN_REQUIRED.test(statusNote);
}

/** Only a later verified sign-in can clear a stop that was caused by missing sign-in. */
export function canResumeAfterVerifiedSignIn(status: AccountState, statusNote: string, authenticated: boolean): boolean {
  return status === "blocked" && authenticated && accountNeedsSignIn(statusNote);
}
