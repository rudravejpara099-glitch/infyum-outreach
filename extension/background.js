import { readFactsInPage } from "./page-scripts.js";
import { warmUp } from "./actions.js";
import { InstagramBlockedError, InstagramWarmupUncertainError } from "./warmup.js";

const HANDLE = /^[A-Za-z0-9_.]{1,30}$/;
const setStatus = (status) => chrome.storage.local.set({ status });

/** The code is base64url JSON {origin, code}, the same one the Node connector accepts. */
function parseCode(value) {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const parsed = JSON.parse(text);
  const url = new URL(parsed.origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local)) || typeof parsed.code !== "string") throw new Error("bad code");
  return { origin: url.origin, code: parsed.code };
}

async function post(credential, path, body) {
  const response = await fetch(`${credential.origin}${path}`, {
    method: "POST", redirect: "error",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential.token}` },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) { await chrome.storage.local.remove("credential"); throw new Error("revoked"); }
  if (!response.ok) throw new Error("website error");
  return response.json();
}

async function pair(codeText) {
  let parsed;
  try { parsed = parseCode(codeText); } catch { return { error: "That connection code is not valid. Copy it again from Accounts." }; }
  try {
    const response = await fetch(`${parsed.origin}/api/connector/pair`, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: parsed.code, label: "Chrome extension" }),
    });
    if (!response.ok) return { error: "The code expired or was already used. Create a new one in Accounts." };
    const paired = await response.json();
    await chrome.storage.local.set({ credential: { origin: parsed.origin, token: paired.token } });
    await setStatus("Connected. Waiting for work from Outreach.");
    tick();
    return {};
  } catch { return { error: "Could not reach Outreach. Is it running?" }; }
}

/** Open the page in a background tab, run the reader there, and close the tab again. */
async function inTab(url, func, args) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Instagram took too long to load.")), 30_000);
      const listener = (id, info) => { if (id === tab.id && info.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
      chrome.tabs.onUpdated.addListener(listener);
    });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    return result.result;
  } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}

function followers(text) {
  const m = text.replace(/ /g, " ").match(/([\d.,]+\s*[kKmM]?)\s+followers/);
  if (!m) return null;
  const raw = m[1].replace(/\s/g, "").toLowerCase();
  const n = parseFloat(raw.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  return Math.round(raw.endsWith("k") ? n * 1_000 : raw.endsWith("m") ? n * 1_000_000 : n);
}

async function readFacts(handle) {
  const found = await inTab(`https://www.instagram.com/${handle}/`, readFactsInPage, [`/${handle.toLowerCase()}/`]);
  if (!found || found.allowed !== true) throw new Error("Instagram did not show the expected profile.");
  if (found.blocked) { const e = new Error("Instagram needs your attention."); e.blocked = true; throw e; }
  if (found.loggedOut) { const e = new Error("Instagram sign-in is not confirmed in this Chrome."); e.blocked = true; throw e; }
  if (found.restricted) throw new Error("Instagram restricts this profile.");
  if (found.aboutFailed) throw new Error("Instagram's About popup failed to load. Will retry.");
  const count = followers(found.followerText || "");
  if (count === null) throw new Error("Could not read the follower count.");
  if (!["follow", "follow back", "following", "requested"].includes(found.relation)) throw new Error("No clear connection status.");
  return {
    isPublic: found.isPublic === true,
    country: typeof found.country === "string" && !/not shared/i.test(found.country) ? found.country : null,
    followers: count,
    linkedToInfyum: found.relation === "following" || found.relation === "follow back",
  };
}

async function readProfileNotes(handle) {
  const page = await inTab(`https://www.instagram.com/${handle}/`, () => ({
    text: document.querySelector("header")?.innerText ?? "",
    alts: Array.from(document.querySelectorAll("main img[alt]")).map((i) => i.alt).filter((v) => v.length > 20).slice(0, 8),
  }), []);
  if (!page || typeof page.text !== "string") throw new Error("Profile notes were unavailable.");
  return [`Profile header:\n${page.text}`, page.alts.length ? `Recent posts (image descriptions):\n- ${page.alts.join("\n- ")}` : ""].filter(Boolean).join("\n\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * While a write task runs, Outreach is asked once a second whether it may carry on. If it says no, or cannot be reached
 * for five seconds, every step stops (this is how the kill switch reaches a task that is already running).
 */
function watchTask(credential, command) {
  const state = { allowedAt: Date.now(), stopped: false, watching: true, response: command.callbackResponse };
  const refresh = async () => {
    const reply = await post(credential, "/api/connector/poll", { commandId: command.id });
    if (reply.continue !== true || reply.command?.id !== command.id) { state.stopped = true; state.allowedAt = 0; return; }
    state.allowedAt = Date.now(); state.response = reply.command.callbackResponse;
  };
  const monitor = (async () => { while (state.watching) { await sleep(1000); if (!state.watching) break; try { await refresh(); } catch { state.allowedAt = 0; } } })();
  const mayContinue = () => !state.stopped && Date.now() - state.allowedAt < 5000;
  return {
    mayContinue,
    /** Outreach writes the comment (Claude), so it can follow the saved prompt and the repeat rules. */
    async comment(context) {
      if (!mayContinue()) throw new Error("Connection lost. Preparation stopped.");
      const callbackId = crypto.randomUUID();
      await post(credential, "/api/connector/callback", { id: command.id, callbackId, context });
      const deadline = Date.now() + 120_000;
      while (mayContinue() && Date.now() < deadline) {
        if (state.response?.id === callbackId) {
          if (typeof state.response.response === "string") return state.response.response;
          throw new Error("Writing is unavailable. Connect a writing provider in Outreach before preparation.");
        }
        await sleep(100);
      }
      throw new Error("Writing did not complete. Preparation stopped.");
    },
    async finish() { state.watching = false; await monitor; },
  };
}

async function run(command, credential) {
  if (command.kind === "warmUp") {
    const gate = watchTask(credential, command);
    try { return await warmUp(command, gate); } finally { await gate.finish(); }
  }
  const handle = command.args?.handle;
  if (command.kind === "readFacts" && HANDLE.test(handle)) return readFacts(handle);
  if (command.kind === "readProfileNotes" && HANDLE.test(handle)) return readProfileNotes(handle);
  throw new Error("The extension cannot do this action yet.");
}

/** The Stop button: tells Outreach to stop everything, which also cancels a task that is in progress. */
async function stop() {
  const { credential } = await chrome.storage.local.get("credential");
  if (!credential) return { error: "Not connected." };
  try { await post(credential, "/api/connector/kill", {}); await setStatus("Stopped. Resume in Outreach."); return {}; }
  catch { return { error: "Could not reach Outreach. Close this Chrome window to stop actions." }; }
}

let busy = false;
async function tick() {
  if (busy) return;
  const { credential } = await chrome.storage.local.get("credential");
  if (!credential) return;
  busy = true;
  try {
    // Chrome wakes this only every 30 seconds, but Outreach counts a device as online for 30 seconds after it last asked.
    // So keep asking every 5 seconds for most of the gap; that way the device never looks offline between wake-ups.
    let command = null;
    for (let look = 0; look < 6 && !command; look++) {
      const reply = await post(credential, "/api/connector/poll", {});
      if (reply.killed) { await setStatus("Stopped. Resume in Outreach."); return; }
      // A newer copy of the extension is on disk: reload so changes apply without visiting chrome://extensions.
      if (!reply.command && typeof reply.extensionVersion === "string" && reply.extensionVersion !== chrome.runtime.getManifest().version) { chrome.runtime.reload(); return; }
      command = reply.command;
      if (!command) { await setStatus("Connected. Waiting for work from Outreach."); if (look < 5) await sleep(5000); }
    }
    if (!command) return;
    if (command.expiresAt <= Date.now()) return;
    await setStatus(`Working: ${command.kind}…`);
    // The server confirms the task is still allowed before anything touches Instagram.
    const check = await post(credential, "/api/connector/poll", { commandId: command.id });
    if (check.continue !== true) return;
    try {
      const result = await run(command, credential);
      await post(credential, "/api/connector/result", { id: command.id, result });
      await setStatus("Finished. Check Outreach for the result.");
    } catch (error) {
      const writes = command.kind === "warmUp" || command.kind === "sendMessages";
      const why = String(error.reason || error.message || error).slice(0, 200);
      const blocked = error.blocked === true || error instanceof InstagramBlockedError || (error instanceof InstagramWarmupUncertainError && error.blockedByInstagram);
      await post(credential, "/api/connector/result", { id: command.id, error: writes ? `The operation did not finish. Review it in Outreach before retrying. Cause: ${why}` : (error.message || "The action did not finish."), uncertain: writes, blockedByInstagram: blocked });
      await setStatus(`That action did not finish: ${why.slice(0, 120)}`);
    }
  } catch (error) {
    await setStatus(error.message === "revoked" ? "This connection was revoked. Create a new code in Accounts." : "Outreach is unreachable. Waiting to retry.");
  } finally { busy = false; }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === "pair") pair(String(message.code || "")).then(reply);
  else if (message?.type === "stop") stop().then(reply);
  else if (message?.type === "disconnect") chrome.storage.local.remove(["credential", "status"]).then(() => reply({}));
  else return false;
  return true;
});
chrome.alarms.create("poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "poll") tick(); });
chrome.runtime.onStartup.addListener(tick);
chrome.runtime.onInstalled.addListener(tick);
tick();
