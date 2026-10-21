import { describe, expect, it } from "vitest";
import { followersFromText, hasInstagramSession, looksBlocked, looksLoggedOut, parseCount, skipComment } from "@/worker/parse";

describe("instagram text helpers", () => {
  it("confirms sign-in from cookie presence only and rejects login/challenge pages", () => {
    expect(hasInstagramSession([{ name: "sessionid", value: "present" }], "https://www.instagram.com/")).toBe(true);
    expect(hasInstagramSession([{ name: "csrftoken", value: "present" }], "https://www.instagram.com/")).toBe(false);
    expect(hasInstagramSession([{ name: "sessionid", value: "present" }], "https://www.instagram.com/accounts/login/")).toBe(false);
    expect(hasInstagramSession([{ name: "sessionid", value: "present" }], "https://www.instagram.com/challenge/")).toBe(false);
  });
  it("parses counts", () => {
    expect(parseCount("4,728")).toBe(4728);
    expect(parseCount("13.5K")).toBe(13500);
    expect(parseCount("2.3M")).toBe(2300000);
    expect(parseCount("abc")).toBeNull();
  });
  it("reads followers from header text", () => {
    expect(followersFromText("290 posts 4,728 followers 63 following")).toBe(4728);
    expect(followersFromText("60.8k followers")).toBe(60800);
    expect(followersFromText("nothing here")).toBeNull();
  });
  it("skips sensitive posts only", () => {
    expect(skipComment("We will miss you. Funeral on Friday")).toBe(true);
    expect(skipComment("Stripe payouts are now faster")).toBe(false); // 'rip' only counts as a whole word
    expect(skipComment("RIP to a legend")).toBe(true);
    expect(skipComment("God is good, blessed Sunday")).toBe(true);
    expect(skipComment("Your credit score jumped 80 points")).toBe(false);
  });
  it("spots warnings and logouts", () => {
    expect(looksBlocked("Try Again Later. We limit how often you can do this.", "https://www.instagram.com/")).toBe(true);
    expect(looksBlocked("fine", "https://www.instagram.com/challenge/123/")).toBe(true);
    expect(looksBlocked("Welcome back", "https://www.instagram.com/")).toBe(false);
    expect(looksLoggedOut("https://www.instagram.com/accounts/login/?next=/")).toBe(true);
    expect(looksLoggedOut("https://www.instagram.com/public.profile/", "Log in to see photos and videos from friends")).toBe(true);
    expect(looksLoggedOut("https://www.instagram.com/public.profile/", "Sign up to view posts from this profile")).toBe(true);
    expect(looksLoggedOut("https://www.instagram.com/public.profile/", "Log in · Sign up · Instagram")).toBe(false);
  });
});
