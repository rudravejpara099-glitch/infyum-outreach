import { describe, expect, it } from "vitest";
import { accountNeedsSignIn, canResumeAfterVerifiedSignIn } from "@/lib/domain/account-recovery";

describe("account sign-in recovery", () => {
  it("recognizes sign-in failures without treating Instagram warnings as sign-in failures", () => {
    expect(accountNeedsSignIn("The saved Instagram account is not signed in in Chrome.")).toBe(true);
    expect(accountNeedsSignIn("Instagram sign-in is not confirmed for this account.")).toBe(true);
    expect(accountNeedsSignIn("Instagram showed a warning or a human check. Review the account in Chrome.")).toBe(false);
    expect(accountNeedsSignIn("Action blocked. Review this account in Instagram.")).toBe(false);
  });

  it("clears a sign-in-only stop only after sign-in is verified", () => {
    expect(canResumeAfterVerifiedSignIn("blocked", "The saved Instagram account is not signed in in Chrome.", true)).toBe(true);
    expect(canResumeAfterVerifiedSignIn("blocked", "The saved Instagram account is not signed in in Chrome.", false)).toBe(false);
    expect(canResumeAfterVerifiedSignIn("blocked", "Instagram showed a warning or a human check.", true)).toBe(false);
    expect(canResumeAfterVerifiedSignIn("active", "The saved Instagram account is not signed in in Chrome.", true)).toBe(false);
    expect(canResumeAfterVerifiedSignIn("paused", "The saved Instagram account is not signed in in Chrome.", true)).toBe(false);
  });
});
