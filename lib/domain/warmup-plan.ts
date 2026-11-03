/** How a warm-up visit is shaped. Pure: the caller supplies the random source, so tests can fix it.
 * Follows phase1/GUIDE-FOR-CLAUDE.md 4.3: posts picked at random from the newest ~12, many skipped,
 * a typical visit touches 2 to 5 posts, some get only a like, and the follow and story come at varied moments. */
export const WARMUP_WINDOW = 12;

export type WarmupPick = { url: string; comment: boolean };
export type WarmupPlan = { picks: WarmupPick[]; followFirst: boolean; reactToStory: boolean };

export type Rng = () => number;

/** `budget` is the most posts this visit may touch (the daily room, at most 10). With an rng that always returns 0
 * the plan is the plain case: two posts, each liked and commented on, the follow last, the story reacted to. */
export function planWarmup(postUrls: string[], budget: number, rng: Rng = Math.random): WarmupPlan {
  const pool = postUrls.slice(0, WARMUP_WINDOW);
  // Fisher-Yates shuffle: any order, never the grid from the top down.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = i - Math.floor(rng() * (i + 1)); // an rng of 0 leaves the order alone
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const most = Math.max(0, Math.min(budget, pool.length));
  const wanted = Math.min(most, 2 + Math.floor(rng() * 4)); // 2 to 5
  return {
    // Likes outnumber comments: roughly half the touched posts also get a comment.
    picks: pool.slice(0, wanted).map((url) => ({ url, comment: rng() < 0.55 })),
    followFirst: rng() > 0.7,
    reactToStory: rng() < 0.4,
  };
}
