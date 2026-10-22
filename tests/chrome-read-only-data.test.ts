import { describe, expect, it } from "vitest";
import { inboxIdentityUrl, inboxItemFromToolResult, inboxListScript, inboxThreadPathsFromToolResult, inboxThreadScript, inboxThreadUrl, profileFactsFromToolResult, profileFactsScript } from "@/worker/chrome-read-only-data";

const mcpJson = (value: unknown) => ({ content: [{ type: "text", text: `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }] });

describe("Chrome read-only data adapter", () => {
  it("reads profile facts only after exact target and owner identity checks", () => {
    const script = profileFactsScript("owner.handle", "target");
    expect(script).toContain("location.pathname.toLowerCase() === \"/target/\"");
    expect(script).toContain("new URL(a.href).pathname.toLowerCase() === \"/owner.handle/\"");
    expect(script.indexOf("if (!allowed || !ownerMatches) return")).toBeLessThan(script.indexOf("document.body?.innerText"));
    expect(profileFactsFromToolResult(mcpJson({
      allowed: true, ownerMatches: true, blocked: false, loggedOut: false,
      isPublic: true, followerText: "5.2K followers", relation: "Follow back", country: "United States",
    }))).toEqual({ isPublic: true, followers: 5200, linkedToInfyum: true, country: "United States" });
  });

  it("fails closed for owner mismatch, missing relationship proof, bad followers, and Instagram warnings", () => {
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, ownerMatches: false }))).toThrow("saved Instagram account");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, ownerMatches: true, relation: "", followerText: "5K followers" }))).toThrow("clear connection status");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, ownerMatches: true, relation: "Follow", followerText: "unknown" }))).toThrow("follower count");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, ownerMatches: true, blocked: true }))).toThrow("warning or human check");
    expect(() => profileFactsScript("owner", "https://attacker.example")).toThrow("Invalid Instagram handle");
  });

  it("lists only bounded inbox thread paths after exact owner binding", () => {
    expect(inboxIdentityUrl()).toBe("https://www.instagram.com/direct/inbox/");
    expect(inboxListScript("owner")).toContain("location.pathname.replace(/\\/$/, '').toLowerCase() === '/direct/inbox'");
    expect(inboxThreadPathsFromToolResult(mcpJson({ allowed: true, ownerMatches: true, items: ["/direct/t/1/", "/direct/t/2/", "/not-a-thread/"] })))
      .toEqual(["/direct/t/1/", "/direct/t/2/"]);
    expect(() => inboxThreadPathsFromToolResult(mcpJson({ allowed: true, ownerMatches: false, items: ["/direct/t/1/"] }))).toThrow("saved Instagram account");
    expect(() => inboxThreadUrl("/direct/t/../other/")).toThrow("Invalid Instagram inbox thread");
  });

  it("accepts only identity-bound incoming thread data and rejects outbound or malformed rows", () => {
    const script = inboxThreadScript("owner", "/direct/t/123/");
    expect(script).toContain("location.pathname.replace(/\\/$/, '') === \"/direct/t/123\"");
    expect(script.indexOf("if (!allowed || !ownerMatches) return")).toBeLessThan(script.indexOf("document.body?.innerText"));
    expect(inboxItemFromToolResult(mcpJson({ allowed: true, ownerMatches: true, handle: "Lead.Name", message: "Thanks, tell me more" })))
      .toEqual({ handle: "lead.name", text: "Thanks, tell me more" });
    expect(inboxItemFromToolResult(mcpJson({ allowed: true, ownerMatches: true, handle: "lead", message: "" }))).toBeNull();
    expect(() => inboxItemFromToolResult(mcpJson({ allowed: true, ownerMatches: false, handle: "lead", message: "private" }))).toThrow("saved Instagram account");
    expect(() => inboxThreadScript("owner", "https://attacker.example/")).toThrow("Invalid Instagram inbox thread");
  });
});
