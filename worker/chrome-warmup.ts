import { warmupCommentError } from "@/lib/domain/warmup-comment";
import { InstagramBlockedError, InstagramWarmupUncertainError, type WarmUpResult } from "./driver";
import { looksBlocked, looksLoggedOut, skipComment } from "./parse";
import { instagramPostUrl, type WarmupPage } from "./chrome-warmup-data";
import type { DelayKind } from "@/lib/domain/pacing";

export type WarmupBrowser = {
  navigate(url: string): Promise<void>;
  read(url: string, comment?: string): Promise<WarmupPage>;
  click(name: string): Promise<void>;
  comment(text: string): Promise<void>;
  wait(kind: DelayKind): Promise<void>;
  /** Fresh reload of the current page (used once when Instagram stays on its splash). */
  reload?(): Promise<void>;
};

/** Uses fresh controls and receipt checks; a partial warm-up is never replayed automatically. */
export async function runChromeWarmup(browser: WarmupBrowser, profileUrl: string, pieces: number,
  makeComment: (context: string) => Promise<string>, mayContinue = () => true): Promise<WarmUpResult> {
  if (!Number.isSafeInteger(pieces) || pieces < 1 || pieces > 10) throw new Error("Warm-up needs 1 to 10 posts.");
  const reloaded = new Set<string>();
  const check = async (url: string, comment?: string) => {
    if (!mayContinue()) throw new Error("Campaign preparation was stopped.");
    let state = await browser.read(url, comment);
    // A tab can get stuck on Instagram's splash; one fresh reload usually brings the page.
    const notLoaded = (page: typeof state) => page.allowed && !page.ownerMatches && page.canComment !== true && page.ownerLinks === 0 && !looksLoggedOut(url, page.text);
    if (notLoaded(state) && browser.reload && !reloaded.has(url)) {
      reloaded.add(url);
      await browser.reload();
      state = await browser.read(url, comment);
    }
    if (!state.allowed) throw new Error(`Chrome left the expected Instagram page${state.at ? ` (it was on ${String(state.at).slice(0, 80)})` : ""}.`);
    if (looksBlocked(state.text, url)) throw new InstagramBlockedError("Instagram showed a warning or human check. Review the account in Chrome.");
    // Narrow windows can hide the profile link; the comment box also proves the visitor is signed in.
    const signedIn = state.ownerMatches || state.canComment === true;
    // A page with no account links at all and no login prompt simply has not loaded; that is not a sign-out.
    if (!signedIn && state.ownerLinks === 0 && !looksLoggedOut(url, state.text)) throw new Error(`Instagram did not finish loading ${String(state.at ?? url).slice(0, 80)}.`);
    if (!signedIn || looksLoggedOut(url, state.text)) {
      const why = !signedIn ? `no signed-in profile link or comment box (${state.ownerLinks ?? "?"} plain links)` : "a login prompt was shown";
      throw new InstagramBlockedError(`The saved Instagram account is no longer signed in in Chrome (on ${String(state.at ?? url).slice(0, 80)}: ${why}).`);
    }
    return state;
  };
  let attempted = false;
  const result: WarmUpResult = { likes: 0, comments: 0, followed: false };
  try {
    const profile = await check(profileUrl);
    const posts = [...new Set(profile.postUrls.map(instagramPostUrl).filter((url): url is string => url !== null))].slice(0, pieces);
    if (posts.length < pieces) throw new Error(`This profile needs ${pieces} available posts before warm-up can finish.`);
    for (const url of posts) {
      // Only post URLs actually read from this profile may be opened.
      const target = new URL(url);
      if (!/^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/$/.test(target.href)) throw new Error("Instagram returned an invalid post link.");
      await browser.navigate(url);
      await browser.wait("read");
      let post = await check(url);
      if (!post.caption) throw new Error("Instagram did not provide enough post context for a specific comment.");
      let comment: string | null = null;
      // Never comment twice on one post: an interrupted warm-up may already have commented here.
      if (!skipComment(post.caption) && !post.ownerCommented) {
        comment = (await makeComment(post.caption.slice(0, 400))).trim();
        const error = warmupCommentError(comment);
        if (error) throw new Error(error);
        post = await check(url); // The account/page may change while writing takes time.
      }
      if (!post.liked) {
        attempted = true;
        await browser.click("Like");
        await browser.wait("afterLike");
        if (!(await check(url)).liked) throw new Error("Instagram did not confirm the like.");
      }
      result.likes++;
      if (comment) {
        await browser.wait("beforeComment");
        await check(url);
        attempted = true;
        await browser.comment(comment);
        await browser.wait("read");
        // Instagram can take a few seconds to show a new comment; look again before calling it unconfirmed.
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
