import { describe, expect, it } from "vitest";
import { planWarmup, WARMUP_WINDOW } from "@/lib/domain/warmup-plan";

const posts = Array.from({ length: 20 }, (_, i) => `https://www.instagram.com/p/post${i}/`);
function seeded(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

describe("planWarmup", () => {
  it("with a random source of 0 gives the plain visit: first posts in order, commented, story, follow last", () => {
    const plan = planWarmup(posts.slice(0, 5), 4, () => 0);
    expect(plan.picks).toEqual([{ url: posts[0], comment: true }, { url: posts[1], comment: true }]);
    expect(plan.followFirst).toBe(false);
    expect(plan.reactToStory).toBe(true);
  });
  it("never touches more posts than the budget, the profile has, or five", () => {
    for (let seed = 1; seed < 200; seed++) {
      const rng = seeded(seed);
      expect(planWarmup(posts, 10, rng).picks.length).toBeLessThanOrEqual(5);
      expect(planWarmup(posts, 10, seeded(seed)).picks.length).toBeGreaterThanOrEqual(2);
      expect(planWarmup(posts, 1, seeded(seed)).picks).toHaveLength(1);
      expect(planWarmup(posts.slice(0, 3), 10, seeded(seed)).picks.length).toBeLessThanOrEqual(3);
      expect(planWarmup([], 10, seeded(seed)).picks).toHaveLength(0);
    }
  });
  it("picks only from the newest window, without repeats, and does not always walk the grid from the top", () => {
    const firstPicks = new Set<string>();
    for (let seed = 1; seed < 200; seed++) {
      const urls = planWarmup(posts, 10, seeded(seed)).picks.map((p) => p.url);
      expect(new Set(urls).size).toBe(urls.length);
      for (const url of urls) expect(posts.indexOf(url)).toBeLessThan(WARMUP_WINDOW);
      firstPicks.add(urls[0]);
    }
    expect(firstPicks.size).toBeGreaterThan(5);
  });
  it("varies comments, the follow moment and the story, so no two visits look alike", () => {
    const plans = Array.from({ length: 300 }, (_, i) => planWarmup(posts, 10, seeded(i + 1)));
    const picks = plans.flatMap((p) => p.picks);
    const commentShare = picks.filter((p) => p.comment).length / picks.length;
    expect(commentShare).toBeGreaterThan(0.4);
    expect(commentShare).toBeLessThan(0.7);
    expect(plans.some((p) => p.followFirst) && plans.some((p) => !p.followFirst)).toBe(true);
    expect(plans.some((p) => p.reactToStory) && plans.some((p) => !p.reactToStory)).toBe(true);
  });
});
