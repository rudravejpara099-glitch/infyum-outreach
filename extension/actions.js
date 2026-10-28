// Actions that change things on Instagram. The warm-up rules (what to like, when to skip a comment, how to confirm)
// come from the same code the Node connector uses (warmup.js, built from worker/chrome-warmup.ts).
import { warmupInPage, storyLikeInPage, tagPostLikeInPage } from "./page-scripts.js";
import { runChromeWarmup, humanDelayMs } from "./warmup.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HANDLE = /^[A-Za-z0-9_.]{1,30}$/;

/** A separate small window that does not take focus, so the user's own tabs are never touched. */
async function openWorkWindow(url) {
  const win = await chrome.windows.create({ url, focused: false, type: "normal", width: 1100, height: 900 });
  return { windowId: win.id, tabId: win.tabs[0].id };
}
async function loaded(tabId, timeout = 30_000) {
  const start = Date.now();
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    if (Date.now() - start > timeout) throw new Error("Instagram took too long to load.");
    await sleep(250);
  }
}
const instagramUrl = (value) => { const url = new URL(value); if (url.protocol !== "https:" || !["www.instagram.com", "instagram.com"].includes(url.hostname)) throw new Error("Not an Instagram address."); return url.href; };

/** Real, trusted mouse and keyboard input through Chrome's debugging interface (Chrome shows its usual "debugging" bar while this runs). */
function inputFor(tabId) {
  const target = { tabId };
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
  return {
    attach: () => chrome.debugger.attach(target, "1.3"),
    detach: () => chrome.debugger.detach(target).catch(() => {}),
    async click(x, y) {
      const jitter = () => (Math.random() - 0.5) * 4;
      const px = x + jitter(), py = y + jitter();
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py });
      await sleep(60 + Math.random() * 120);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", buttons: 1, clickCount: 1 });
      await sleep(40 + Math.random() * 80);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px, y: py, button: "left", clickCount: 1 });
    },
    async type(text) { await send("Input.insertText", { text }); },
    async enter() {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    },
  };
}

const exec = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId }, func, args }))[0]?.result;

/** Where a visible button with this exact name is, in page coordinates, after scrolling it into view. */
function rectOfNamed(name) {
  const scopes = [document.querySelector("header"), document.querySelector("article"), document.querySelector("main"), document].filter(Boolean);
  for (const scope of scopes) {
    const found = Array.from(scope.querySelectorAll("button,[role=button]")).find((e) => {
      const label = (e.getAttribute("aria-label") || e.innerText || "").trim();
      const r = e.getBoundingClientRect();
      return label === name && r.width > 0 && r.height > 0;
    });
    if (found) {
      found.scrollIntoView({ block: "center" });
      const r = found.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const top = document.elementFromPoint(x, y);
      // Only click when the button itself is what is under that point; otherwise say what is in the way.
      if (!top || !(found.contains(top) || top.contains(found))) {
        const what = top ? `${top.tagName.toLowerCase()} ${(top.getAttribute("aria-label") || top.innerText || "").trim().slice(0, 30)}` : "nothing";
        return { x, y, covered: `${what} (window ${innerWidth}x${innerHeight}, button at ${Math.round(x)},${Math.round(y)})` };
      }
      return { x, y };
    }
  }
  return null;
}
function rectOfCommentBox() {
  const box = document.querySelector('textarea[aria-label*="comment" i],textarea[placeholder*="comment" i]');
  if (!box) return null;
  box.scrollIntoView({ block: "center" }); box.focus();
  const r = box.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Runs one warm-up: story like, a like and a comment on each of the newest posts, then a follow.
 * `gate` says whether Outreach still allows the task (the kill switch and every other stop come through it).
 */
export async function warmUp(command, gate) {
  const handle = command.args?.handle, pieces = command.args?.pieces, owner = command.account?.handle;
  if (!HANDLE.test(handle) || !HANDLE.test(owner) || !Number.isSafeInteger(pieces) || pieces < 1 || pieces > 10) throw new Error("This warm-up request is not valid.");
  const profileUrl = instagramUrl(`https://www.instagram.com/${handle}/`);
  const { windowId, tabId } = await openWorkWindow(profileUrl);
  const input = inputFor(tabId);
  let diag = "";
  try {
    await loaded(tabId);
    await input.attach();
    const browser = {
      navigate: async (url) => { await chrome.tabs.update(tabId, { url: instagramUrl(url) }); await sleep(500); await loaded(tabId); },
      reload: async () => { await chrome.tabs.reload(tabId, { bypassCache: true }); await sleep(500); await loaded(tabId); },
      read: async (url, comment = "") => {
        const path = new URL(url).pathname;
        return exec(tabId, warmupInPage, [[path, path.replace(/^\/reel\//, "/reels/")], `/${owner.toLowerCase()}/`, comment]);
      },
      likeStory: async () => exec(tabId, storyLikeInPage, [`/stories/${handle.toLowerCase()}/`]),
      click: async (name) => {
        if (name === "Like") {
          const tag = await exec(tabId, tagPostLikeInPage);
          if (tag?.tagged === true) name = "Outreach post like";
        }
        const spot = await exec(tabId, rectOfNamed, [name]);
        if (!spot) throw new Error(`Instagram did not show a ${name} button.`);
        if (spot.covered) throw new Error(`The ${name} button was covered by ${spot.covered}.`);
        await input.click(spot.x, spot.y);
        await sleep(400);
        const state = await exec(tabId, () => ({ visible: document.visibilityState, focused: document.hasFocus(), w: innerWidth, h: innerHeight, under: (() => { const e = document.elementFromPoint(0, 0); return e?.tagName; })() })).catch(() => null);
        diag = `${name} clicked at ${Math.round(spot.x)},${Math.round(spot.y)}; page ${state ? `${state.visible}, focused=${state.focused}, ${state.w}x${state.h}` : "unreadable"}`;
      },
      comment: async (text) => {
        const spot = await exec(tabId, rectOfCommentBox);
        if (!spot) throw new Error("Instagram did not show a comment box.");
        await input.type(text);
        await sleep(400 + Math.random() * 500);
        await input.enter();
      },
      wait: async (kind) => { await sleep(humanDelayMs(kind, Math.random)); },
    };
    const result = await runChromeWarmup(browser, profileUrl, pieces, gate.comment, gate.mayContinue);
    return { likes: result.likes, comments: result.comments, followed: result.followed };
  } catch (error) {
    if (diag && error && typeof error === "object") error.reason = `[${diag}] ${error.reason || error.message}`.slice(0, 190);
    throw error;
  } finally {
    await input.detach();
    chrome.windows.remove(windowId).catch(() => {});
  }
}

const BLOCKED = /action blocked|try again later|we restrict certain activity|confirm you'?re (a )?human|suspicious (activity|login)|account has been (disabled|suspended|temporarily locked)|help us confirm/i;

/** Page-side helpers for sending. Each is self-contained because it runs inside the Instagram page. */
function pageState(ownerPath) {
  const text = document.body?.innerText ?? "";
  const ownerSignedIn = Array.from(document.querySelectorAll("a[href]")).some((a) => (a.getAttribute("href") || "").toLowerCase() === ownerPath);
  return { host: location.hostname, path: location.pathname, text: text.slice(0, 4000), ownerSignedIn, hasMessageButton: Array.from(document.querySelectorAll("button,[role=button]")).some((e) => (e.getAttribute("aria-label") || e.innerText || "").trim() === "Message") };
}
function chatState() {
  const box = document.querySelector('[contenteditable="true"][role="textbox"], textarea[placeholder*="essage" i]');
  let area = box;
  for (let level = 0; area && level < 16 && (area.innerText || "").length < 300; level++) area = area.parentElement;
  return { found: Boolean(box), ours: /infyum|portfolio\.infyum\.com/i.test(area?.innerText || "") };
}
function focusChatBox() {
  const box = document.querySelector('[contenteditable="true"][role="textbox"], textarea[placeholder*="essage" i]');
  if (!box) return null;
  box.scrollIntoView({ block: "center" }); box.focus();
  const r = box.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
function bodyText() { return document.body?.innerText ?? ""; }

/**
 * Sends the approved first message (up to three parts) to one profile, in a real chat, one part at a time.
 * Never starts if our name or link is already in the conversation, and confirms each part appears before the next.
 */
export async function sendMessages(command, gate) {
  const handle = command.args?.handle, parts = command.args?.parts, owner = command.account?.handle;
  if (!HANDLE.test(handle) || !HANDLE.test(owner) || !Array.isArray(parts) || parts.length < 1 || parts.length > 3 || parts.some((p) => typeof p !== "string" || !p.trim() || p.length > 2000)) throw new Error("This message request is not valid.");
  const stop = () => { if (!gate.mayContinue()) throw new Error("Message sending was stopped."); };
  stop();
  const { windowId, tabId } = await openWorkWindow(instagramUrl(`https://www.instagram.com/${handle}/`));
  const input = inputFor(tabId);
  let attempted = false;
  try {
    await loaded(tabId);
    await input.attach();
    // The signed-in account must be the saved one, and the Message button must show (up to about 15 seconds).
    let state = null;
    for (let look = 0; look < 10; look++) {
      state = await exec(tabId, pageState, [`/${owner.toLowerCase()}/`]);
      if (state?.ownerSignedIn && state.hasMessageButton) break;
      stop(); await sleep(1500);
    }
    if (!state || state.host !== "www.instagram.com") throw new Error("Chrome left the expected Instagram page.");
    if (BLOCKED.test(state.text)) { const e = new Error("Instagram showed a warning or human check. Review the account in Chrome."); e.blocked = true; throw e; }
    if (!state.ownerSignedIn) { const e = new Error("The saved Instagram account is not signed in in Chrome."); e.blocked = true; throw e; }
    if (!state.hasMessageButton) throw new Error(`@${handle} has no Message button (messages may be closed).`);
    stop();
    const button = await exec(tabId, rectOfNamed, ["Message"]);
    if (!button) throw new Error("Instagram did not show a Message button.");
    if (button.covered) throw new Error(`The Message button was covered by ${button.covered}.`);
    await input.click(button.x, button.y);
    // The chat opens a moment after the click; wait for its message box (up to about 15 seconds).
    let chat = null;
    for (let look = 0; look < 10 && !chat?.found; look++) { await sleep(1500); stop(); chat = await exec(tabId, chatState); }
    if (!chat?.found) throw new Error(`Chat with @${handle} did not open.`);
    if (chat.ours) throw new Error(`@${handle} was already messaged by us on Instagram before; the message was not sent.`);
    for (const [index, part] of parts.entries()) {
      stop();
      const box = await exec(tabId, focusChatBox);
      if (!box) throw new Error("Instagram did not show a message box.");
      await input.click(box.x, box.y);
      await input.type(part);
      await sleep(humanDelayMs("beforeSend", Math.random));
      stop();
      attempted = true;
      await input.enter();
      // Give the sent text a few seconds to appear in the conversation before deciding it was sent.
      const probe = part.slice(0, Math.min(30, part.length));
      let seen = false, text = "";
      for (let look = 0; look < 20 && !seen; look++) { await sleep(400); text = await exec(tabId, bodyText); seen = text.includes(probe); }
      if (BLOCKED.test(text)) { const e = new Error("Instagram showed a warning or human check. Review the account in Chrome."); e.blocked = true; throw e; }
      if (!seen) throw new Error(`The message to @${handle} did not appear in the conversation.`);
      if (index < parts.length - 1) await sleep(humanDelayMs("betweenParts", Math.random));
    }
    return null;
  } catch (error) {
    if (attempted && error && typeof error === "object") error.reason = `${error.message}`.slice(0, 190);
    throw error;
  } finally {
    await input.detach();
    chrome.windows.remove(windowId).catch(() => {});
  }
}
