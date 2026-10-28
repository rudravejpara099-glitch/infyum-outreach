// lib/domain/warmup-comment.ts
function warmupCommentError(text) {
  if (/[{}]|```|~~~/.test(text) || /^\s*\[|\]\s*$/.test(text)) return "Comments must be plain text without JSON or code fences.";
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const emoji = [...new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)].filter(({ segment }) => new RegExp("\\p{Extended_Pictographic}", "u").test(segment)).length;
  if (words.length < 3 || words.length > 8) return "Comments need 3 to 8 words.";
  if (emoji < 1 || emoji > 3) return "Comments need 1 to 3 emojis.";
  if (/[-‐‑‒–—―#]|https?:\/\//i.test(text)) return "Comments cannot contain dashes, hashtags, or links.";
  return null;
}

// worker/driver.ts
var InstagramBlockedError = class extends Error {
};
var InstagramWarmupUncertainError = class extends Error {
  constructor(blockedByInstagram = false, reason = "") {
    super("Warm-up may be partly complete. Check this profile on Instagram before preparing it again.");
    this.blockedByInstagram = blockedByInstagram;
    this.reason = reason.slice(0, 160);
  }
};

// worker/parse.ts
var SENSITIVE_POST = /\b(rip|passed away|funeral|grief|mourning|condolence|pray(er|ing|ers)?|god|jesus|bible|church|blessed|election|vote|trump|biden|democrat|republican|gaza|palestin|israel|abortion)\b/i;
function skipComment(caption) {
  return SENSITIVE_POST.test(caption);
}
var BLOCK_SIGNS = [
  /action blocked/i,
  /try again later/i,
  /we restrict certain activity/i,
  /confirm you'?re (a )?human/i,
  /suspicious (activity|login)/i,
  /your account has been (disabled|suspended|temporarily locked)/i,
  /help us confirm/i
];
function looksBlocked(pageText, url) {
  return /\/(challenge|accounts\/suspended)\//.test(url) || BLOCK_SIGNS.some((r) => r.test(pageText));
}
var LOGIN_PROMPTS = [
  /log in to (?:see|view) (?:photos|posts|this profile|content)/i,
  /sign up to (?:see|view) (?:photos|posts|this profile|content)/i,
  /see photos, videos and more from[\s\S]{0,200}sign up and never miss a post/i,
  /log in to continue/i,
  /you need to log in to continue/i
];
function looksLoggedOut(url, pageText = "") {
  return /\/accounts\/login/i.test(url) || LOGIN_PROMPTS.some((pattern) => pattern.test(pageText));
}

// worker/chrome-warmup-data.ts
function instagramPostUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
    return match ? `https://www.instagram.com/p/${match[2]}/` : null;
  } catch {
    return null;
  }
}

// worker/chrome-warmup.ts
async function runChromeWarmup(browser, profileUrl, pieces, makeComment, mayContinue = () => true) {
  if (!Number.isSafeInteger(pieces) || pieces < 1 || pieces > 10) throw new Error("Warm-up needs 1 to 10 posts.");
  const reloaded = /* @__PURE__ */ new Set();
  const check = async (url, comment) => {
    if (!mayContinue()) throw new Error("Campaign preparation was stopped.");
    let state = await browser.read(url, comment);
    const notLoaded = (page) => page.allowed && !page.ownerMatches && page.canComment !== true && page.ownerLinks === 0 && !looksLoggedOut(url, page.text);
    if (notLoaded(state) && browser.reload && !reloaded.has(url)) {
      reloaded.add(url);
      await browser.reload();
      state = await browser.read(url, comment);
    }
    if (!state.allowed) throw new Error(`Chrome left the expected Instagram page${state.at ? ` (it was on ${String(state.at).slice(0, 80)})` : ""}.`);
    if (looksBlocked(state.text, url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
    const signedIn = state.ownerMatches || state.canComment === true;
    if (!signedIn && state.ownerLinks === 0 && !looksLoggedOut(url, state.text)) throw new Error(`Instagram did not finish loading ${String(state.at ?? url).slice(0, 80)}.`);
    if (!signedIn || looksLoggedOut(url, state.text)) {
      const why = !signedIn ? `no signed-in profile link or comment box (${state.ownerLinks ?? "?"} plain links)` : "a login prompt was shown";
      throw new InstagramBlockedError(`The saved Instagram account is no longer signed in in Chrome (on ${String(state.at ?? url).slice(0, 80)}: ${why}).`);
    }
    return state;
  };
  let attempted = false;
  const result = { likes: 0, comments: 0, followed: false };
  try {
    const profile = await check(profileUrl);
    const posts = [...new Set(profile.postUrls.map(instagramPostUrl).filter((url) => url !== null))].slice(0, pieces);
    if (posts.length < pieces) throw new Error(`This profile needs ${pieces} available posts before warm-up can finish.`);
    if (browser.likeStory && !profile.following) {
      attempted = true;
      try {
        const story = await browser.likeStory();
        if (story.hadStory) result.storyLiked = story.liked;
      } catch (error) {
        if (error instanceof InstagramBlockedError) throw error;
      }
      await browser.navigate(profileUrl);
      await browser.wait("read");
      await check(profileUrl);
    }
    for (const url of posts) {
      const target = new URL(url);
      if (!/^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/$/.test(target.href)) throw new Error("Instagram returned an invalid post link.");
      await browser.navigate(url);
      await browser.wait("read");
      let post = await check(url);
      if (!post.caption) throw new Error("Instagram did not provide enough post context for a specific comment.");
      let comment = null;
      if (!skipComment(post.caption) && !post.ownerCommented) {
        try {
          comment = (await makeComment(post.caption.slice(0, 400))).trim();
          if (warmupCommentError(comment)) comment = null;
        } catch (error) {
          if (!(error instanceof Error) || !/^Comment writing did not return valid text/.test(error.message)) throw error;
          comment = null;
        }
        post = await check(url);
      }
      if (!post.liked) {
        attempted = true;
        await browser.click("Like");
        await browser.wait("afterLike");
        let after = await check(url);
        for (let look = 0; !after.liked && look < 5; look++) {
          await browser.wait("afterLike");
          after = await check(url);
        }
        if (!after.liked) throw new Error(`Instagram did not confirm the like (page said: ${String(after.text ?? "").replace(/\s+/g, " ").slice(0, 160)}).`);
      }
      result.likes++;
      if (comment) {
        await browser.wait("beforeComment");
        await check(url);
        attempted = true;
        await browser.comment(comment);
        await browser.wait("read");
        let confirmed = (await check(url, comment)).commentVisible;
        for (let look = 0; !confirmed && look < 4; look++) {
          await browser.wait("afterLike");
          confirmed = (await check(url, comment)).commentVisible;
        }
        if (!confirmed) throw new Error("Instagram did not confirm the comment.");
        result.comments++;
      }
      await browser.wait("betweenPieces");
    }
    await browser.navigate(profileUrl);
    await browser.wait("read");
    const profileAfter = await check(profileUrl);
    if (!profileAfter.following) {
      attempted = true;
      await browser.click("Follow");
      await browser.wait("read");
    }
    result.followed = (await check(profileUrl)).following;
    if (!result.followed) throw new Error("Instagram did not confirm following this profile.");
    return result;
  } catch (error) {
    if (attempted) throw new InstagramWarmupUncertainError(error instanceof InstagramBlockedError, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// lib/domain/pacing.ts
var RANGES_MS = {
  read: [2500, 9e3],
  afterLike: [900, 3e3],
  beforeComment: [3e3, 9e3],
  typeKey: [60, 210],
  beforeSend: [800, 2500],
  betweenParts: [6e3, 22e3],
  // time between the three DMs, like a person typing the next one
  betweenPieces: [8e3, 12e3],
  // from one post to the next (build plan: 8 to 12 seconds, plus the occasional longer pause below)
  betweenChecks: [2e4, 7e4],
  betweenLeads: [9e4, 3e5],
  // after a full warm-up
  betweenDms: [18e4, 54e4]
  // after a DM
};
function humanDelayMs(kind, rng) {
  const [lo, hi] = RANGES_MS[kind];
  let ms = lo + (hi - lo) * Math.pow(rng(), 1.6);
  if (kind !== "typeKey" && rng() < 0.06) ms *= 1.5 + rng();
  return Math.round(ms);
}
export {
  InstagramBlockedError,
  InstagramWarmupUncertainError,
  humanDelayMs,
  runChromeWarmup
};
