// Human-like movement for the browser. Timing numbers come from lib/domain/pacing.ts.
import type { Locator, Page } from "playwright";
import { humanDelayMs, type DelayKind } from "@/lib/domain/pacing";

const rng = Math.random;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + (b - a) * rng();
const last = new WeakMap<Page, { x: number; y: number }>();

export const wait = (kind: DelayKind) => sleep(humanDelayMs(kind, rng));

/** Moves the mouse along a gentle curve with small wobbles, not a straight jump. */
export async function move(page: Page, x: number, y: number): Promise<void> {
  const from = last.get(page) ?? { x: rand(100, 400), y: rand(100, 300) };
  const dist = Math.hypot(x - from.x, y - from.y);
  const steps = Math.min(45, Math.round(12 + dist / 40));
  const c1 = { x: from.x + (x - from.x) * 0.3 + rand(-60, 60), y: from.y + (y - from.y) * 0.1 + rand(-60, 60) };
  const c2 = { x: from.x + (x - from.x) * 0.8 + rand(-40, 40), y: from.y + (y - from.y) * 0.9 + rand(-40, 40) };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const px = u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * x;
    const py = u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * y;
    await page.mouse.move(px, py);
    await sleep(rand(5, 18));
  }
  last.set(page, { x, y });
}

/** Scrolls the element into view, moves to a random spot inside it, pauses, then presses like a finger. */
export async function click(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) { await target.click(); return; }
  await move(page, box.x + box.width * rand(0.25, 0.75), box.y + box.height * rand(0.3, 0.7));
  await sleep(rand(60, 220));
  await page.mouse.down();
  await sleep(rand(40, 110));
  await page.mouse.up();
}

/** One key at a time with uneven rhythm and small thinking pauses. */
export async function type(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(humanDelayMs("typeKey", rng) + (/[\s.,!?]/.test(ch) && rng() < 0.12 ? rand(150, 450) : 0));
  }
}

/** Scrolls down in a few uneven steps, like reading. */
export async function scroll(page: Page, totalPx: number): Promise<void> {
  let done = 0;
  while (done < totalPx) {
    const chunk = rand(80, 220);
    await page.mouse.wheel(0, chunk);
    done += chunk;
    await sleep(rand(120, 400));
  }
}

/** Looks at a page the way a person does: a pause, a bit of scrolling, another pause. */
export async function look(page: Page): Promise<void> {
  await wait("read");
  if (rng() < 0.7) await scroll(page, rand(150, 500));
  await sleep(rand(400, 1500));
}
