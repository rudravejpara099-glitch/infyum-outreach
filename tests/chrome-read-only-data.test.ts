import { describe, expect, it } from "vitest";
import { inboxIdentityUrl, inboxItemFromToolResult, inboxListScript, inboxThreadPathsFromToolResult, inboxThreadScript, inboxThreadUrl, profileFactsFromToolResult, profileFactsScript } from "@/worker/chrome-read-only-data";

const mcpJson = (value: unknown) => ({ content: [{ type: "text", text: `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }] });

describe("Chrome read-only data adapter", () => {
  it("reads profile facts only after exact target and owner identity checks", () => {
    const script = profileFactsScript("target");
    expect(script).toContain("location.pathname.toLowerCase() === \"/target/\"");
    expect(script).toContain("location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com'");
    expect(script.indexOf("if (!allowed) return")).toBeLessThan(script.indexOf("document.body?.innerText"));
    expect(script).toContain("const deadline = Date.now() + 6000");
    expect(script).toContain("while (!ready() && Date.now() < deadline)");
    expect(script).not.toContain("ownerMatches");
    expect(profileFactsFromToolResult(mcpJson({
      allowed: true, blocked: false, loggedOut: false,
      isPublic: true, followerText: "5.2K followers", relation: "Follow back", country: "United States",
    }))).toEqual({ isPublic: true, followers: 5200, linkedToInfyum: true, country: "United States" });
  });

  it("fails closed for owner mismatch, missing relationship proof, bad followers, and Instagram warnings", () => {
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: false }))).toThrow("expected Instagram profile");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, relation: "", followerText: "5K followers" }))).toThrow("clear connection status");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, relation: "Follow", followerText: "unknown" }))).toThrow("follower count");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, blocked: true }))).toThrow("warning or human check");
    expect(() => profileFactsFromToolResult(mcpJson({ allowed: true, restricted: true }))).toThrow("restricts this profile");
    expect(() => profileFactsScript("https://attacker.example")).toThrow("Invalid Instagram handle");
  });

  it("recognizes an age-restricted page without waiting for a profile header", async () => {
    const run = new Function("location", "document", `return (${profileFactsScript("target")})`) as
      (location: unknown, document: unknown) => () => Promise<unknown>;
    const result = await run(
      { protocol: "https:", hostname: "www.instagram.com", pathname: "/target/" },
      { body: { innerText: "Restricted profile You must be 25 years old or over to see this profile" }, querySelector: () => null },
    )();
    expect(result).toEqual({ allowed: true, restricted: true });
  });

  it("clicks the interactive Options ancestor rather than an icon", async () => {
    let clicked = false;
    const button = { click: () => { clicked = true; } };
    const header = {
      innerText: "686m followers",
      querySelector: () => ({ closest: () => button }),
      querySelectorAll: () => [{ innerText: "Follow", getAttribute: () => null }],
    };
    const run = new Function("location", "document", `return (${profileFactsScript("target")})`) as
      (location: unknown, document: unknown) => () => Promise<unknown>;
    const result = await run(
      { protocol: "https:", hostname: "www.instagram.com", pathname: "/target/" },
      { body: { innerText: "686m followers" }, querySelector: (selector: string) => selector === "header" ? header : null, querySelectorAll: () => [] },
    )();
    expect(clicked).toBe(true);
    expect(result).toMatchObject({ allowed: true, followerText: "686m followers", relation: "follow" });
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
