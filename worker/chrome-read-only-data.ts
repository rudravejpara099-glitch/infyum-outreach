import { InstagramBlockedError, type ProfileFacts } from "./driver";
import { followersFromText } from "./parse";
import { instagramProfileUrl, jsonFromToolResult } from "./chrome-read-only";

type ToolResult = { isError?: boolean; content?: { type: string; text: string }[]; structuredContent?: { message?: string } };
const safeHandle = (handle: string) => new URL(instagramProfileUrl(handle)).pathname.toLowerCase();

/** The caller verifies the saved owner first; this script rechecks the exact target page before reading it. */
export function profileFactsScript(targetHandle: string): string {
  const targetPath = safeHandle(targetHandle);
  return `async () => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.toLowerCase() === ${JSON.stringify(targetPath)};
    if (!allowed) return { allowed, blocked: false };
    const ready = () => {
      const text = document.body?.innerText ?? '';
      return /restricted profile|you must be \\d+ years old or over to see this profile/i.test(text) ||
        Boolean(document.querySelector('header') &&
          (/followers|this account is private|log in to continue|you need to log in to continue|action blocked|try again later|confirm you'?re (a )?human|help us confirm/i.test(text)));
    };
    const deadline = Date.now() + 6000;
    while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    const body = document.body?.innerText ?? '';
    if (/restricted profile|you must be \\d+ years old or over to see this profile/i.test(body)) return { allowed, restricted: true };
    const blocked = /action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i.test(body) || /\\/(challenge|accounts\\/suspended)\\//i.test(location.pathname);
    if (blocked) return { allowed, blocked: true, text: body.slice(0, 1200) };
    if (/log in to (see|view)|sign up to (see|view)|log in to continue|you need to log in to continue/i.test(body)) return { allowed, loggedOut: true };
    const header = document.querySelector('header');
    const headerText = header?.innerText ?? '';
    const followerText = headerText.match(/[\\d.,]+\\s*[kKmM]?\\s+followers/i)?.[0] ??
      (document.querySelector('a[href$="/followers/"]')?.innerText ?? '');
    const relation = Array.from(header?.querySelectorAll('button,[role=button]') ?? []).map((e) =>
      (e.getAttribute('aria-label') || e.innerText || '').trim().toLowerCase()).find((s) => /^(follow|follow back|following|requested)$/.test(s)) ?? '';
    let country = null;
    const options = header?.querySelector('[aria-label="Options"],[aria-label="More options"]')?.closest('button,[role="button"]');
    if (options && typeof options.click === 'function') {
      options.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const about = Array.from(document.querySelectorAll('button,[role=button],a,div'))
        .find((e) => (e.innerText || '').trim() === 'About this account');
      if (about) {
        about.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const afterDialog = document.body?.innerText ?? '';
        if (/action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i.test(afterDialog) || /\\/(challenge|accounts\\/suspended)\\//i.test(location.pathname)) {
          return { allowed, blocked: true };
        }
        const dialogText = document.querySelector('[role=dialog]')?.innerText ?? '';
        const match = dialogText.replace(/\\u00a0/g, ' ').match(/Account based in\\s*\\n?\\s*([^\\n]+)/i);
        country = match?.[1]?.trim() || null;
        if (/not shared/i.test(country || '')) country = null;
      }
    }
    return {
      allowed, blocked: false, loggedOut: false,
      isPublic: !/this account is private/i.test(body), followerText, relation, country,
    };
  }`;
}

export function profileFactsFromToolResult(result: ToolResult): ProfileFacts {
  if (result.isError) throw new Error("Chrome could not read Instagram profile facts.");
  const parsed = jsonFromToolResult(result) as Record<string, unknown> | null;
  if (!parsed || parsed.allowed !== true) throw new Error("Chrome is no longer showing the expected Instagram profile.");
  if (parsed.blocked === true) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
  if (parsed.restricted === true) throw new Error("Instagram restricts this profile, so its facts cannot be read.");
  if (parsed.loggedOut === true) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
  const followerText = typeof parsed.followerText === "string" ? parsed.followerText : "";
  const followers = followersFromText(followerText);
  if (followers === null) throw new Error("Could not read the Instagram follower count safely.");
  const relation = typeof parsed.relation === "string" ? parsed.relation.toLowerCase() : "";
  if (!["follow", "follow back", "following", "requested"].includes(relation)) throw new Error("Instagram did not show a clear connection status for this profile.");
  return {
    isPublic: parsed.isPublic === true,
    country: typeof parsed.country === "string" && !/not shared/i.test(parsed.country) ? parsed.country : null,
    followers,
    linkedToInfyum: relation === "following" || relation === "follow back",
  };
}

export function inboxListScript(ownerHandle: string): string {
  const ownerPath = safeHandle(ownerHandle);
  return `() => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.replace(/\\/$/, '').toLowerCase() === '/direct/inbox';
    const ownerMatches = Array.from(document.querySelectorAll('a[href]')).some((a) => {
      try { return new URL(a.href).pathname.toLowerCase() === ${JSON.stringify(ownerPath)}; } catch { return false; }
    });
    if (!allowed || !ownerMatches) return { allowed, ownerMatches, blocked: false, items: [] };
    const text = document.body?.innerText ?? '';
    const blocked = /action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i.test(text) || /\\/(challenge|accounts\\/suspended)\\//i.test(location.pathname);
    if (blocked) return { allowed, ownerMatches, blocked: true, items: [] };
    if (/log in to continue|you need to log in to continue/i.test(text)) return { allowed, ownerMatches, loggedOut: true, items: [] };
    const items = Array.from(document.querySelectorAll('a[href^="/direct/t/"]')).slice(0, 15).map((a) => new URL(a.href).pathname);
    return { allowed, ownerMatches, blocked: false, loggedOut: false, items };
  }`;
}

export function inboxThreadPathsFromToolResult(result: ToolResult): string[] {
  if (result.isError) throw new Error("Chrome could not read Instagram replies.");
  const parsed = jsonFromToolResult(result) as { allowed?: unknown; ownerMatches?: unknown; blocked?: unknown; loggedOut?: unknown; items?: unknown } | null;
  if (!parsed || parsed.allowed !== true || parsed.ownerMatches !== true) throw new Error("The saved Instagram account could not be confirmed before reading replies.");
  if (parsed.blocked === true) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
  if (parsed.loggedOut === true) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
  if (!Array.isArray(parsed.items)) throw new Error("Instagram did not return a readable reply list.");
  const paths: string[] = [];
  for (const item of parsed.items.slice(0, 15)) {
    if (typeof item === "string" && /^\/direct\/t\/[A-Za-z0-9_-]+\/?$/.test(item)) paths.push(item);
  }
  return [...new Set(paths)];
}

export function inboxThreadScript(ownerHandle: string, path: string): string {
  const ownerPath = safeHandle(ownerHandle);
  if (!/^\/direct\/t\/[A-Za-z0-9_-]+\/?$/.test(path)) throw new Error("Invalid Instagram inbox thread.");
  return `() => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.replace(/\\/$/, '') === ${JSON.stringify(path.replace(/\/$/, ""))};
    const ownerMatches = Array.from(document.querySelectorAll('a[href]')).some((a) => {
      try { return new URL(a.href).pathname.toLowerCase() === ${JSON.stringify(ownerPath)}; } catch { return false; }
    });
    if (!allowed || !ownerMatches) return { allowed, ownerMatches, blocked: false };
    const body = document.body?.innerText ?? '';
    const blocked = /action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i.test(body) || /\\/(challenge|accounts\\/suspended)\\//i.test(location.pathname);
    if (blocked) return { allowed, ownerMatches, blocked: true };
    if (/log in to continue|you need to log in to continue/i.test(body)) return { allowed, ownerMatches, loggedOut: true };
    const handleLink = Array.from(document.querySelectorAll('a[href]')).find((a) => {
      try { return /^\\/[A-Za-z0-9._]+\\/$/.test(new URL(a.href).pathname) && new URL(a.href).pathname.toLowerCase() !== ${JSON.stringify(ownerPath)}; } catch { return false; }
    });
    const handle = handleLink ? new URL(handleLink.href).pathname.replace(/\\//g, '') : '';
    const last = document.querySelector('div[role="row"]:last-of-type')?.innerText?.trim() ?? '';
    const outgoing = /^You:\\s*/i.test(last);
    return { allowed, ownerMatches, blocked: false, loggedOut: false, handle, message: outgoing ? '' : last };
  }`;
}

export function inboxItemFromToolResult(result: ToolResult): { handle: string; text: string } | null {
  if (result.isError) throw new Error("Chrome could not read an Instagram reply.");
  const parsed = jsonFromToolResult(result) as Record<string, unknown> | null;
  if (!parsed || parsed.allowed !== true || parsed.ownerMatches !== true) throw new Error("The saved Instagram account could not be confirmed before reading this conversation.");
  if (parsed.blocked === true) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
  if (parsed.loggedOut === true) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
  if (typeof parsed.handle !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(parsed.handle)) return null;
  if (typeof parsed.message !== "string" || !parsed.message.trim()) return null;
  return { handle: parsed.handle.toLowerCase(), text: parsed.message.trim().slice(0, 2000) };
}

export function inboxIdentityUrl(): string { return "https://www.instagram.com/direct/inbox/"; }
export function inboxThreadUrl(path: string): string {
  if (!/^\/direct\/t\/[A-Za-z0-9_-]+\/?$/.test(path)) throw new Error("Invalid Instagram inbox thread.");
  return `https://www.instagram.com${path}`;
}
