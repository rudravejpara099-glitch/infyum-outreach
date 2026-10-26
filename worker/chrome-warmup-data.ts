export type WarmupPage = {
  allowed: boolean; ownerMatches: boolean; text: string; caption: string;
  postUrls: string[]; liked: boolean; following: boolean; commentVisible: boolean;
  /** Our account already has a comment on this post (from an earlier, interrupted warm-up). */
  ownerCommented?: boolean;
  /** Where the tab actually was when it was not on the expected page (host and path only). */
  at?: string;
};

/** Instagram's profile grid includes /handle/p/id links; opening them resolves to /p/id. */
export function instagramPostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
    return match ? `https://www.instagram.com/${match[1]}/${match[2]}/` : null;
  } catch { return null; }
}

/** Reads only the exact profile/post selected by the driver. Never performs an action. */
export function warmupPageScript(expectedUrl: string, ownerHandle: string, comment = ""): string {
  const url = new URL(expectedUrl);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)
    || !/^\/(?:[a-zA-Z0-9._]+|(?:p|reel)\/[a-zA-Z0-9_-]+)\/$/.test(url.pathname)
    || !/^[a-zA-Z0-9._]{1,30}$/.test(ownerHandle)) throw new Error("Invalid Instagram warm-up target.");
  return `async () => {
    // A tab that was just opened or navigated may not have reached its address yet; give it a moment.
    const arriveBy = Date.now() + 8000;
    while (location.pathname !== ${JSON.stringify(url.pathname)} && Date.now() < arriveBy) await new Promise(r => setTimeout(r, 250));
    const allowed = location.protocol === 'https:' &&
      (location.hostname === 'www.instagram.com' || location.hostname === 'instagram.com') &&
      location.pathname === ${JSON.stringify(url.pathname)};
    if (!allowed) return { allowed: false, at: location.hostname + location.pathname };
    const until = Date.now() + 6000;
    while (!document.querySelector('main,article') && Date.now() < until) await new Promise(r => setTimeout(r, 200));
    // A profile's post grid renders about a second after <main>; reading at once finds no posts.
    // Wait until ten posts show, or until the count has stopped growing for about a second.
    if (/^\\/[A-Za-z0-9._]+\\/$/.test(location.pathname)) {
      const gridUntil = Date.now() + 8000;
      const gridPosts = () => Array.from((document.querySelector('article') ?? document.querySelector('main'))?.querySelectorAll('a[href]') ?? [])
        .filter(a => /\\/(p|reel)\\//.test(String(a.href || ''))).length;
      let last = -1, steady = 0;
      while (Date.now() < gridUntil) {
        const count = gridPosts();
        if (count >= 10) break;
        steady = count > 0 && count === last ? steady + 1 : 0;
        if (steady >= 4) break;
        last = count;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    const text = document.body?.innerText ?? '';
    const root = document.querySelector('article') ?? document.querySelector('main');
    const ownerPath = ${JSON.stringify(`/${ownerHandle.toLowerCase()}/`)};
    const ownerMatches = Array.from(document.querySelectorAll('a[href]')).some(a =>
      a.getAttribute('href')?.toLowerCase() === ownerPath &&
      (/profile/i.test(a.getAttribute('aria-label') || '') || Array.from(a.querySelectorAll('img')).some(img => /profile picture/i.test(img.alt))));
    const caption = (root?.querySelector('h1')?.innerText ?? '').trim() ||
      Array.from(root?.querySelectorAll('img[alt]') ?? []).map(img => img.alt).find(alt => alt.length > 20 && !/profile picture/i.test(alt)) || '';
    const postUrls = [...new Set(Array.from(root?.querySelectorAll('a[href]') ?? []).map(a => {
      try { const u = new URL(a.href); const post = u.pathname.match(/^\\/(?:[A-Za-z0-9._]+\\/)?(p|reel)\\/([A-Za-z0-9_-]+)\\/?$/); return u.protocol === 'https:' &&
        (u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com') && post ? 'https://www.instagram.com/' + post[1] + '/' + post[2] + '/' : ''; }
      catch { return ''; }
    }).filter(Boolean))];
    const labels = Array.from(root?.querySelectorAll('[aria-label]') ?? []).map(e => e.getAttribute('aria-label'));
    const following = Array.from(root?.querySelectorAll('button,[role=button]') ?? []).some(e => /^(Following|Requested)$/.test((e.innerText || '').trim()));
    const comment = ${JSON.stringify(comment)};
    const input = root?.querySelector('textarea[aria-label*="comment" i],textarea[placeholder*="comment" i]');
    // Comment rows are plain blocks now: find our exact text, then our profile link within a few levels.
    const commentVisible = Boolean(comment && input && !input.value && Array.from(root?.querySelectorAll('span') ?? []).some(span => {
      if (span.textContent?.trim() !== comment) return false;
      let row = span.parentElement;
      for (let level = 0; level < 4 && row; level++, row = row.parentElement) {
        if (Array.from(row.querySelectorAll('a[href]')).some(a => a.getAttribute('href')?.toLowerCase() === ownerPath)) return true;
      }
      return false;
    }));
    // Inside the post, our profile link only appears on our own comments.
    const ownerCommented = Array.from(root?.querySelectorAll('a[href]') ?? []).some(a => a.getAttribute?.('href')?.toLowerCase() === ownerPath);
    return { allowed: true, ownerMatches, text, caption, postUrls, liked: labels.includes('Unlike'), following, commentVisible, ownerCommented };
  }`;
}
