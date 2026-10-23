import { describe, expect, it } from "vitest";
import { inboxIdentityUrl, inboxItemFromToolResult, inboxListScript, inboxOpenThreadScript, inboxThreadIndicesFromToolResult, inboxThreadIsLoadingFromToolResult, inboxThreadPathFromToolResult, inboxThreadScript, inboxThreadUrl, isInboxLoadingRowText, profileFactsFromToolResult, profileFactsScript } from "@/worker/chrome-read-only-data";

const mcpJson = (value: unknown) => ({ content: [{ type: "text", text: `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }] });
const runPageScript = async (script: string, location: Record<string, unknown>, document: Record<string, unknown>, style: (element: unknown) => { justifyContent: string } = () => ({ justifyContent: "flex-start" }), date: unknown = Date, timer: unknown = setTimeout) => {
  const make = new Function("location", "document", "URL", "Date", "setTimeout", "getComputedStyle", `return (${script})`) as (...args: unknown[]) => () => Promise<unknown>;
  return make(location, document, URL, date, timer, style)();
};

class FastDate extends Date {
  static tick = 0;
  static now(): number { FastDate.tick += 250; return FastDate.tick; }
}
const runFastScript = async (script: string, location: Record<string, unknown>, document: Record<string, unknown>) => {
  const make = new Function("location", "document", "URL", "Date", "setTimeout", "getComputedStyle", `return (${script})`) as (...args: unknown[]) => () => Promise<unknown>;
  FastDate.tick = 0;
  return make(location, document, URL, FastDate, (fn: () => void) => { fn(); return 0; }, () => ({ justifyContent: "flex-start" }))();
};

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

  it("finds the target profile relationship control just outside the header", async () => {
    const follow = { innerText: "Follow", getAttribute: () => null };
    const parent = { querySelectorAll: () => [follow], parentElement: null };
    const header = {
      innerText: "17.4K followers",
      parentElement: parent,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const result = await runFastScript(profileFactsScript("target"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/target/" }, {
      body: { innerText: "17.4K followers" },
      querySelector: (selector: string) => selector === "header" ? header : null,
      querySelectorAll: () => [],
    });
    expect(result).toMatchObject({ allowed: true, followerText: "17.4K followers", relation: "follow" });
  });

  it("fails closed when the nearest profile container has conflicting relationship controls", async () => {
    const parent = {
      querySelectorAll: () => [
        { innerText: "Follow", getAttribute: () => null },
        { innerText: "Following", getAttribute: () => null },
      ],
      parentElement: null,
    };
    const header = { innerText: "17.4K followers", parentElement: parent, querySelector: () => null, querySelectorAll: () => [] };
    const result = await runFastScript(profileFactsScript("target"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/target/" }, {
      body: { innerText: "17.4K followers" },
      querySelector: (selector: string) => selector === "header" ? header : null,
      querySelectorAll: () => [],
    });
    expect(result).toMatchObject({ allowed: true, relation: "" });
    expect(() => profileFactsFromToolResult(mcpJson(result))).toThrow("clear connection status");
  });

  it("waits for the About dialog before reading the public account country", async () => {
    let aboutClicked = false;
    let dialogChecks = 0;
    let closed = false;
    const dialog = { innerText: "Account based in\nUnited States", querySelectorAll: () => [{ innerText: "Close", click: () => { closed = true; } }] };
    const header = {
      innerText: "5.2K followers",
      querySelector: () => ({ closest: () => ({ click: () => {} }) }),
      querySelectorAll: () => [{ innerText: "Follow", getAttribute: () => null }],
    };
    const document = {
      body: { innerText: "5.2K followers" },
      querySelector: (selector: string) => selector === "header" ? header : null,
      querySelectorAll: (selector: string) => selector === "[role=dialog]" ? (aboutClicked && ++dialogChecks >= 3 ? [dialog] : []) : [{ innerText: "About this account", click: () => { aboutClicked = true; } }],
    };
    const result = await runFastScript(profileFactsScript("target"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/target/" }, document);
    expect(result).toMatchObject({ allowed: true, country: "United States" });
    expect(dialogChecks).toBeGreaterThanOrEqual(3);
    expect(closed).toBe(true);
  });

  it("reads an already open About panel without toggling Options", async () => {
    let optionsClicked = false;
    const dialog = { innerText: "Account based in\nUnited States", querySelectorAll: () => [] };
    const header = {
      innerText: "5.2K followers",
      querySelector: () => ({ closest: () => ({ click: () => { optionsClicked = true; } }) }),
      querySelectorAll: () => [{ innerText: "Follow", getAttribute: () => null }],
    };
    const result = await runFastScript(profileFactsScript("target"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/target/" }, {
      body: { innerText: "5.2K followers" },
      querySelector: (selector: string) => selector === "header" ? header : null,
      querySelectorAll: (selector: string) => selector === "[role=dialog]" ? [dialog] : [],
    });
    expect(result).toMatchObject({ allowed: true, country: "United States" });
    expect(optionsClicked).toBe(false);
  });

  it("lists at most 15 nonempty thread-row indices without returning previews", async () => {
    expect(inboxIdentityUrl()).toBe("https://www.instagram.com/direct/inbox/");
    expect(inboxListScript("owner")).toContain('[aria-label="Thread list"]');
    expect(isInboxLoadingRowText("Loading... Loading... Loading...")).toBe(true);
    expect(isInboxLoadingRowText("Loading more conversations…")).toBe(true);
    expect(isInboxLoadingRowText("Maria: thanks for reaching out")).toBe(false);
    const owner = { href: "https://www.instagram.com/owner/" };
    const rows = [{ innerText: "Your note", querySelector: () => ({}), closest: () => ({}) }, ...Array.from({ length: 18 }, (_, i) => ({ innerText: i === 3 ? "" : `private preview ${i}`, querySelector: () => ({}), closest: () => null })), { innerText: "Loading... Loading... Loading...", querySelector: () => ({}), closest: () => null }];
    const document = { querySelectorAll: () => [owner], querySelector: () => ({ querySelectorAll: () => rows }), body: { innerText: "Inbox" } };
    const result = await runPageScript(inboxListScript("owner"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" }, document);
    expect(result).toMatchObject({ allowed: true, ownerMatches: true, isInbox: true, listReady: true });
    expect((result as { indices: number[] }).indices).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(JSON.stringify(result)).not.toContain("private preview");
    const onlyReadyRow = { innerText: "ready thread", querySelector: () => ({}), closest: () => null };
    const loadingRow = { innerText: "Loading... Loading... Loading...", querySelector: () => ({}), closest: () => null };
    const loadingResult = await runPageScript(inboxListScript("owner"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" }, {
      querySelectorAll: () => [owner], querySelector: () => ({ querySelectorAll: () => [onlyReadyRow, loadingRow] }), body: { innerText: "Inbox" },
    });
    expect((loadingResult as { indices: number[] }).indices).toEqual([0]);
    expect(inboxThreadIndicesFromToolResult(mcpJson({ allowed: true, ownerMatches: true, isInbox: true, listReady: true, indices: [0, 2, 15, -1, "3", 2, 14, 200] }))).toEqual([0, 2, 14]);
    expect(inboxThreadIndicesFromToolResult(mcpJson({ allowed: true, ownerMatches: true, isInbox: true, listReady: true, indices: [] }))).toEqual([]);
    expect(() => inboxThreadIndicesFromToolResult(mcpJson({ allowed: true, ownerMatches: false, isInbox: true, indices: [0] }))).toThrow("saved Instagram account");
    expect(() => inboxThreadIndicesFromToolResult(mcpJson({ allowed: true, ownerMatches: true, isInbox: true, blocked: true, indices: [] }))).toThrow("warning or human check");
    expect(() => inboxThreadIndicesFromToolResult(mcpJson({ allowed: true, ownerMatches: true, isInbox: false, indices: [] }))).toThrow("conversation list is not open");
    expect(() => inboxThreadIndicesFromToolResult(mcpJson({ allowed: true, ownerMatches: true, isInbox: true, listReady: false, indices: [] }))).toThrow("still loading");
  });

  it("distinguishes a blank loading inbox from a different signed-in account", async () => {
    class QuickDate extends Date {
      static calls = 0;
      static now(): number { return QuickDate.calls++ === 0 ? 0 : 20_000; }
    }
    const location = { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" };
    const run = (readyState: string, links: { href: string }[]) => {
      QuickDate.calls = 0;
      return runPageScript(inboxListScript("owner"), location, {
        readyState,
        body: Object.defineProperty({}, "innerText", { get: () => { throw new Error("unverified inbox text must not be read"); } }),
        querySelector: () => null,
        querySelectorAll: () => links,
      }, undefined, QuickDate, (callback: () => void) => { callback(); });
    };
    const loading = await run("loading", []);
    expect(loading).toMatchObject({ allowed: true, ownerMatches: false, isInbox: true, loading: true });
    const otherAccount = await run("complete", [{ href: "https://www.instagram.com/otheraccount/" }]);
    expect(otherAccount).toMatchObject({ allowed: true, ownerMatches: false, isInbox: true, loading: false });
    expect(() => inboxThreadIndicesFromToolResult(mcpJson(otherAccount))).toThrow("saved Instagram account");
  });

  it("waits for the signed-in inbox identity and thread list to load", async () => {
    class DelayedDate extends Date {
      static tick = 0;
      static now(): number { DelayedDate.tick += 250; return DelayedDate.tick; }
    }
    const owner = { href: "https://www.instagram.com/owner/" };
    const row = { innerText: "thread row", querySelector: () => ({}), closest: () => null };
    const list = { querySelectorAll: () => [row] };
    const document = {
      querySelectorAll: () => DelayedDate.tick > 7000 ? [owner] : [],
      querySelector: () => DelayedDate.tick > 9000 ? list : null,
      body: { innerText: "Inbox" },
    };
    const run = new Function("location", "document", "URL", "Date", "setTimeout", `return (${inboxListScript("owner")})`) as
      (location: unknown, document: unknown, url: unknown, date: unknown, timer: unknown) => () => Promise<unknown>;
    DelayedDate.tick = 0;
    const result = await run(
      { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" },
      document,
      URL,
      DelayedDate,
      (fn: () => void) => { fn(); return 0; },
    )();
    expect(result).toMatchObject({ allowed: true, ownerMatches: true, isInbox: true, listReady: true, indices: [0] });
  });

  it("fails before reading body text when the host, path or owner does not match", async () => {
    const body = Object.defineProperty({}, "innerText", { get: () => { throw new Error("body must not be read"); } });
    const document = { querySelectorAll: () => [], querySelector: () => null, body };
    expect(await runPageScript(inboxListScript("owner"), { protocol: "https:", hostname: "evil.example", pathname: "/direct/inbox/" }, document))
      .toMatchObject({ allowed: false, indices: [] });
    expect(await runFastScript(inboxListScript("owner"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" }, document))
      .toMatchObject({ allowed: true, ownerMatches: false, indices: [] });
    expect(await runPageScript(inboxListScript("owner"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/accounts/login/" }, document))
      .toMatchObject({ allowed: false, indices: [] });
  });

  it("accepts an owner-bound existing conversation page without treating it as an inbox", async () => {
    const owner = { href: "https://www.instagram.com/owner/" };
    const body = Object.defineProperty({}, "innerText", { get: () => { throw new Error("thread body must not be read while selecting list page"); } });
    const document = { querySelectorAll: () => [owner], querySelector: () => null, body };
    expect(await runPageScript(inboxListScript("owner"), { protocol: "https:", hostname: "instagram.com", pathname: "/direct/t/thread_1/" }, document))
      .toEqual({ allowed: true, ownerMatches: true, isInbox: false, blocked: false, loggedOut: false, indices: [] });
  });

  it("uses the verified Messages link to reach the inbox from a loaded conversation", async () => {
    const location = { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/t/thread_1/" };
    const owner = { href: "https://www.instagram.com/owner/" };
    const messages = { href: "https://www.instagram.com/direct/inbox/", click: () => { location.pathname = "/direct/inbox/"; } };
    const row = { innerText: "private preview", closest: () => null, querySelector: () => ({}), click: () => {} };
    const document = { querySelectorAll: () => [owner, messages], querySelector: () => ({ querySelectorAll: () => [row] }), body: { innerText: "Inbox" } };
    const result = await runPageScript(inboxListScript("owner"), location, document);
    expect(result).toMatchObject({ allowed: true, ownerMatches: true, isInbox: true, listReady: true, indices: [0] });
    expect(JSON.stringify(result)).not.toContain("private preview");
  });

  it("opens only a validated nonempty inbox row and returns its exact thread path", async () => {
    const location = { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" };
    let clicked = false, loadingClicked = false;
    const owner = { href: "https://www.instagram.com/owner/" };
    const loadingRow = { innerText: "Loading... Loading... Loading...", querySelector: () => ({}), closest: () => null, click: () => { loadingClicked = true; } };
    const row = { innerText: "private preview", querySelector: () => ({}), closest: () => null, click: () => { clicked = true; location.pathname = "/direct/t/thread_42/"; } };
    const document = { querySelectorAll: () => [owner], querySelector: () => ({ querySelectorAll: () => [loadingRow, row] }), body: { innerText: "Inbox" } };
    const result = await runPageScript(inboxOpenThreadScript("owner", 0), location, document);
    expect(clicked).toBe(true);
    expect(loadingClicked).toBe(false);
    expect(inboxThreadPathFromToolResult(mcpJson(result))).toBe("/direct/t/thread_42/");
    expect(inboxOpenThreadScript("owner", 0)).toContain("isUsableThreadRow");
    const loadingLocation = { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/inbox/" };
    const loadingOnly = await runPageScript(inboxOpenThreadScript("owner", 0), loadingLocation, {
      querySelectorAll: () => [owner], querySelector: () => ({ querySelectorAll: () => [loadingRow] }), body: { innerText: "Inbox" },
    });
    expect(inboxThreadIsLoadingFromToolResult(mcpJson(loadingOnly))).toBe(true);
    expect(loadingLocation.pathname).toBe("/direct/inbox/");
    expect(() => inboxOpenThreadScript("owner", 15)).toThrow("Invalid Instagram conversation index");
    expect(() => inboxThreadPathFromToolResult(mcpJson({ allowed: true, ownerMatches: true, opened: true, path: "/direct/t/../other/" }))).toThrow("verifiable conversation");
    expect(() => inboxThreadUrl("/direct/t/../other/")).toThrow("Invalid Instagram inbox thread");
  });

  it("extracts the partner handle and incoming articles only after exact thread identity", async () => {
    const owner = { href: "https://www.instagram.com/owner/" };
    const partner = { href: "https://www.instagram.com/lead.name/" };
    const incomingWrapper = {}, outgoingWrapper = {};
    const incoming = { innerText: "first real reply", parentElement: { parentElement: incomingWrapper } };
    const outgoing = { innerText: "sent privately", parentElement: { parentElement: outgoingWrapper } };
    const document = {
      querySelectorAll: (selector: string) => selector.startsWith("main [role=\"article\"]") ? [incoming, outgoing] : [owner],
      querySelector: (selector: string) => selector === 'main a[aria-label^="Open the profile page"]' ? partner : selector.startsWith('main [role="article"]') ? incoming : null,
      body: { innerText: "Conversation" },
    };
    const result = await runPageScript(inboxThreadScript("owner", "/direct/t/thread_42/"), { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/t/thread_42/" }, document,
      (element) => ({ justifyContent: element === incomingWrapper ? "flex-start" : "flex-end" }));
    expect(result).toMatchObject({ allowed: true, ownerMatches: true, handle: "lead.name", message: "first real reply" });
    const threadScript = inboxThreadScript("owner", "/direct/t/thread_42/");
    expect(threadScript.indexOf("if (!allowed) return")).toBeLessThan(threadScript.indexOf("const body = document.body?.innerText"));
    expect(inboxItemFromToolResult(mcpJson({ allowed: true, ownerMatches: true, handle: "Lead.Name", message: "Thanks, tell me more" })))
      .toEqual({ handle: "lead.name", text: "Thanks, tell me more" });
    expect(() => inboxItemFromToolResult(mcpJson({ allowed: true, ownerMatches: false, handle: "lead", message: "private" }))).toThrow("saved Instagram account");
    expect(() => inboxItemFromToolResult(mcpJson({ allowed: true, ownerMatches: true, threadReady: false }))).toThrow("still loading");
    const outgoingOnly = { innerText: "sent privately", parentElement: { parentElement: outgoingWrapper } };
    const outgoingDocument = {
      querySelectorAll: (selector: string) => selector.startsWith("main [role=\"article\"]") ? [outgoingOnly] : [owner],
      querySelector: (selector: string) => selector === 'main a[aria-label^="Open the profile page"]' ? partner : selector.startsWith('main [role="article"]') ? outgoingOnly : null,
      body: { innerText: "Conversation" },
    };
    const noIncoming = await runPageScript(threadScript, { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/t/thread_42/" }, outgoingDocument,
      () => ({ justifyContent: "flex-end" }));
    expect(noIncoming).toMatchObject({ allowed: true, ownerMatches: true, handle: "lead.name", message: "" });
    const stillLoading = await runFastScript(threadScript, { protocol: "https:", hostname: "www.instagram.com", pathname: "/direct/t/thread_42/" }, {
      querySelectorAll: (selector: string) => selector.startsWith("main [role=\"article\"]") ? [] : [owner],
      querySelector: (selector: string) => selector === 'main a[aria-label^="Open the profile page"]' ? partner : null,
      body: { innerText: "Conversation" },
    });
    expect(stillLoading).toMatchObject({ allowed: true, ownerMatches: true, threadReady: false });
    expect(() => inboxThreadScript("owner", "https://attacker.example/")).toThrow("Invalid Instagram inbox thread");
  });
});
