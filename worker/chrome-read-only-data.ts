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
    let dialog = Array.from(document.querySelectorAll('[role=dialog]')).find((item) => /Account based in/i.test(item.innerText || ''));
    const options = header?.querySelector('[aria-label="Options"],[aria-label="More options"]')?.closest('button,[role="button"]');
    if (!dialog && options && typeof options.click === 'function') {
      options.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const about = Array.from(document.querySelectorAll('button,[role=button],a,div'))
        .find((e) => (e.innerText || '').trim() === 'About this account');
      if (about) {
        about.click();
        const aboutDeadline = Date.now() + 2000;
        while (!dialog && Date.now() < aboutDeadline) {
          dialog = Array.from(document.querySelectorAll('[role=dialog]')).find((item) => /Account based in/i.test(item.innerText || ''));
          if (!dialog) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (location.pathname.toLowerCase() !== ${JSON.stringify(targetPath)}) return { allowed: false, blocked: false };
        const afterDialog = document.body?.innerText ?? '';
        if (/action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i.test(afterDialog) || /\\/(challenge|accounts\\/suspended)\\//i.test(location.pathname)) {
          return { allowed, blocked: true };
        }
      }
    }
    if (dialog) {
      const match = (dialog.innerText || '').replace(/\\u00a0/g, ' ').match(/Account based in\\s*\\n?\\s*([^\\n]+)/i);
      country = match?.[1]?.trim() || null;
      if (/not shared/i.test(country || '')) country = null;
      const close = Array.from(dialog.querySelectorAll('button')).find((button) => (button.innerText || '').trim() === 'Close');
      close?.click();
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

const THREAD_PATH = /^\/direct\/t\/[A-Za-z0-9_-]+\/?$/;
const THREAD_WARNING = /action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i;

/** Returns only stable row indices, never inbox previews or message contents. */
export function inboxListScript(ownerHandle: string): string {
  const ownerPath = safeHandle(ownerHandle);
  return `async () => {
    const path = location.pathname.replace(/\\/$/, '').toLowerCase();
    let isInbox = path === '/direct/inbox';
    const isThread = /^\\/direct\\/t\\/[A-Za-z0-9_-]+\\/?$/i.test(location.pathname);
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') && (isInbox || isThread);
    if (!allowed) return { allowed: false, ownerMatches: false, isInbox: false, blocked: false, indices: [] };
    const ownerMatches = () => Array.from(document.querySelectorAll('a[href]')).some((a) => {
      try { return new URL(a.href).pathname.toLowerCase() === ${JSON.stringify(ownerPath)}; } catch { return false; }
    });
    const deadline = Date.now() + 6000;
    while (!ownerMatches() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    if (!ownerMatches()) return { allowed: true, ownerMatches: false, isInbox, blocked: false, indices: [] };
    if (!isInbox) {
      const inboxLink = Array.from(document.querySelectorAll('a[href]')).find((link) => {
        try { const url = new URL(link.href); return url.protocol === 'https:' && (url.hostname === 'www.instagram.com' || url.hostname === 'instagram.com') && url.pathname.replace(/\\/$/, '') === '/direct/inbox'; } catch { return false; }
      });
      if (!inboxLink || typeof inboxLink.click !== 'function') return { allowed: true, ownerMatches: true, isInbox: false, blocked: false, loggedOut: false, indices: [] };
      inboxLink.click();
      const inboxDeadline = Date.now() + 6000;
      while (location.pathname.replace(/\\/$/, '') !== '/direct/inbox' && Date.now() < inboxDeadline) await new Promise((resolve) => setTimeout(resolve, 250));
      isInbox = location.protocol === 'https:' && (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') && location.pathname.replace(/\\/$/, '') === '/direct/inbox';
      if (!isInbox || !ownerMatches()) return { allowed: isInbox, ownerMatches: false, isInbox: false, blocked: false, loggedOut: false, indices: [] };
    }
    const text = document.body?.innerText ?? '';
    if (${THREAD_WARNING}.test(text)) return { allowed: true, ownerMatches: true, isInbox, blocked: true, indices: [] };
    if (/log in to continue|you need to log in to continue/i.test(text)) return { allowed: true, ownerMatches: true, isInbox, loggedOut: true, indices: [] };
    const list = document.querySelector('[aria-label="Thread list"]');
    if (!list) return { allowed: true, ownerMatches: true, isInbox: true, listReady: false, blocked: false, loggedOut: false, indices: [] };
    const rows = Array.from(list.querySelectorAll('div[role="button"]')).filter((row) => !row.closest('li') && row.querySelector('img') && typeof row.innerText === 'string' && row.innerText.trim().length > 0);
    return { allowed: true, ownerMatches: true, isInbox: true, listReady: true, blocked: false, loggedOut: false, indices: rows.slice(0, 15).map((_, index) => index) };
  }`;
}

export function inboxThreadIndicesFromToolResult(result: ToolResult): number[] {
  if (result.isError) throw new Error("Chrome could not read Instagram replies.");
  const parsed = jsonFromToolResult(result) as { allowed?: unknown; ownerMatches?: unknown; isInbox?: unknown; listReady?: unknown; blocked?: unknown; loggedOut?: unknown; indices?: unknown } | null;
  if (!parsed || parsed.allowed !== true || parsed.ownerMatches !== true) throw new Error("The saved Instagram account could not be confirmed before reading replies.");
  if (parsed.blocked === true) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
  if (parsed.loggedOut === true) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
  if (parsed.isInbox !== true) throw new Error("Instagram's conversation list is not open.");
  if (parsed.listReady !== true) throw new Error("Instagram's conversation list is still loading.");
  if (!Array.isArray(parsed.indices)) throw new Error("Instagram did not return a readable reply list.");
  return [...new Set(parsed.indices.filter((index): index is number => Number.isSafeInteger(index) && index >= 0 && index < 15))].slice(0, 15);
}

/** Opens one bounded inbox row and returns its URL path only after navigation. */
export function inboxOpenThreadScript(ownerHandle: string, index: number): string {
  const ownerPath = safeHandle(ownerHandle);
  if (!Number.isSafeInteger(index) || index < 0 || index >= 15) throw new Error("Invalid Instagram conversation index.");
  return `async () => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.replace(/\\/$/, '').toLowerCase() === '/direct/inbox';
    if (!allowed) return { allowed: false, ownerMatches: false, opened: false, path: '' };
    const ownerMatches = Array.from(document.querySelectorAll('a[href]')).some((a) => {
      try { return new URL(a.href).pathname.toLowerCase() === ${JSON.stringify(ownerPath)}; } catch { return false; }
    });
    if (!ownerMatches) return { allowed: true, ownerMatches: false, opened: false, path: '' };
    const text = document.body?.innerText ?? '';
    if (${THREAD_WARNING}.test(text)) return { allowed: true, ownerMatches: true, blocked: true, opened: false, path: '' };
    if (/log in to continue|you need to log in to continue/i.test(text)) return { allowed: true, ownerMatches: true, loggedOut: true, opened: false, path: '' };
    const list = document.querySelector('[aria-label="Thread list"]');
    const rows = Array.from(list?.querySelectorAll('div[role="button"]') ?? []).filter((row) => !row.closest('li') && row.querySelector('img') && typeof row.innerText === 'string' && row.innerText.trim().length > 0);
    const row = rows[${index}];
    if (!row || typeof row.click !== 'function') return { allowed: true, ownerMatches: true, opened: false, path: '' };
    row.click();
    const deadline = Date.now() + 6000;
    while (!/^\\/direct\\/t\\/[A-Za-z0-9_-]+\\/?$/i.test(location.pathname) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    const path = location.pathname;
    const opened = /^\\/direct\\/t\\/[A-Za-z0-9_-]+\\/?$/i.test(path);
    return { allowed: true, ownerMatches: true, opened, path: opened ? path : '' };
  }`;
}

export function inboxThreadPathFromToolResult(result: ToolResult): string {
  if (result.isError) throw new Error("Chrome could not open an Instagram reply.");
  const parsed = jsonFromToolResult(result) as { allowed?: unknown; ownerMatches?: unknown; blocked?: unknown; loggedOut?: unknown; opened?: unknown; path?: unknown } | null;
  if (!parsed || parsed.allowed !== true || parsed.ownerMatches !== true) throw new Error("The saved Instagram account could not be confirmed before opening replies.");
  if (parsed.blocked === true) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
  if (parsed.loggedOut === true) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
  if (parsed.opened !== true || typeof parsed.path !== 'string' || !THREAD_PATH.test(parsed.path)) throw new Error("Instagram did not open a verifiable conversation.");
  return parsed.path;
}

export function inboxThreadScript(ownerHandle: string, path: string): string {
  const ownerPath = safeHandle(ownerHandle);
  if (!THREAD_PATH.test(path)) throw new Error("Invalid Instagram inbox thread.");
  const expectedPath = new URL(inboxThreadUrl(path)).pathname.replace(/\/$/, '');
  return `async () => {
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname.replace(/\\/$/, '').toLowerCase() === ${JSON.stringify(expectedPath.toLowerCase())};
    if (!allowed) return { allowed: false, ownerMatches: false, blocked: false };
    const ownerMatches = () => Array.from(document.querySelectorAll('a[href]')).some((a) => {
      try { return new URL(a.href).pathname.toLowerCase() === ${JSON.stringify(ownerPath)}; } catch { return false; }
    });
    const deadline = Date.now() + 6000;
    while (!ownerMatches() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    if (!ownerMatches()) return { allowed: true, ownerMatches: false, blocked: false };
    const body = document.body?.innerText ?? '';
    const blocked = ${THREAD_WARNING}.test(body) || /\\/(challenge|accounts\\/suspended)\\//i.test(location.pathname);
    if (blocked) return { allowed: true, ownerMatches: true, blocked: true };
    if (/log in to continue|you need to log in to continue/i.test(body)) return { allowed: true, ownerMatches: true, loggedOut: true };
    const threadDeadline = Date.now() + 6000;
    while (!document.querySelector('main a[aria-label^="Open the profile page"]') && Date.now() < threadDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const partnerLink = document.querySelector('main a[aria-label^="Open the profile page"]');
    if (!partnerLink) return { allowed: true, ownerMatches: true, blocked: false, loggedOut: false, threadReady: false };
    let handle = '';
    try {
      const partnerPath = new URL(partnerLink?.href ?? '').pathname;
      if (/^\\/[A-Za-z0-9._]{1,30}\\/$/.test(partnerPath) && partnerPath.toLowerCase() !== ${JSON.stringify(ownerPath)}) handle = partnerPath.slice(1, -1);
    } catch { /* no verified partner profile link */ }
    if (!handle) return { allowed, ownerMatches: true, blocked: false, loggedOut: false, handle: '', message: '' };
    const messagesDeadline = Date.now() + 6000;
    while (!document.querySelector('main [role="article"][aria-roledescription="message"]') && Date.now() < messagesDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const articles = Array.from(document.querySelectorAll('main [role="article"][aria-roledescription="message"]'));
    if (articles.length === 0) return { allowed: true, ownerMatches: true, blocked: false, loggedOut: false, threadReady: false };
    const incoming = articles.filter((article) => {
      const wrapper = article.parentElement?.parentElement;
      return wrapper && getComputedStyle(wrapper).justifyContent === 'flex-start';
    });
    const latest = incoming[incoming.length - 1];
    const message = (latest?.innerText ?? latest?.textContent ?? '').trim().slice(0, 2000);
    return { allowed, ownerMatches: true, blocked: false, loggedOut: false, handle, message };
  }`;
}

export function inboxItemFromToolResult(result: ToolResult): { handle: string; text: string } | null {
  if (result.isError) throw new Error("Chrome could not read an Instagram reply.");
  const parsed = jsonFromToolResult(result) as Record<string, unknown> | null;
  if (!parsed || parsed.allowed !== true || parsed.ownerMatches !== true) throw new Error("The saved Instagram account could not be confirmed before reading this conversation.");
  if (parsed.blocked === true) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
  if (parsed.loggedOut === true) throw new InstagramBlockedError("Instagram sign-in is not confirmed for this account. Sign in in Chrome and try again.");
  if (parsed.threadReady === false) throw new Error("Instagram's conversation is still loading; replies were not verified.");
  if (typeof parsed.handle !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(parsed.handle)) return null;
  if (typeof parsed.message !== "string" || !parsed.message.trim()) return null;
  return { handle: parsed.handle.toLowerCase(), text: parsed.message.trim().slice(0, 2000) };
}

export function inboxIdentityUrl(): string { return "https://www.instagram.com/direct/inbox/"; }
export function inboxThreadUrl(path: string): string {
  if (!/^\/direct\/t\/[A-Za-z0-9_-]+\/?$/.test(path)) throw new Error("Invalid Instagram inbox thread.");
  return `https://www.instagram.com${path}`;
}
