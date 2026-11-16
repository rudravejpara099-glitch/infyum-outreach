// Pure helpers for checking phase1/GUIDE-FOR-CLAUDE.md. No side effects, used by tests/phase1-kit.test.ts
// and scripts/kit-lock.ts. The guide is a prompt that real users' Claude runs, so it is checked like code.
import { createHash } from "node:crypto";

export type Section = { id: string; title: string; line: number; level: number };
export type Ref = { id: string; line: number; text: string };

const NUM = String.raw`\d+(?:\.\d+)?`;

/** Lines outside fenced code blocks, with 1-based line numbers. */
export function proseLines(md: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inFence = false;
  md.split("\n").forEach((text, i) => {
    if (text.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push({ n: i + 1, text });
  });
  return out;
}

/** "## 4. Title" -> id "4", "### 4.2 Title" -> id "4.2", "## Appendix A: ..." -> id "A". */
export function parseSections(md: string): Section[] {
  const sections: Section[] = [];
  for (const { n, text } of proseLines(md)) {
    let m = /^##\s+(\d+)\.\s+(.*)$/.exec(text);
    if (m) {
      sections.push({ id: m[1], title: m[2], line: n, level: 2 });
      continue;
    }
    m = /^###\s+(\d+\.\d+)\s+(.*)$/.exec(text);
    if (m) {
      sections.push({ id: m[1], title: m[2], line: n, level: 3 });
      continue;
    }
    m = /^##\s+Appendix\s+([A-Z])\b[:.]?\s*(.*)$/.exec(text);
    if (m) sections.push({ id: m[1], title: m[2], line: n, level: 2 });
  }
  return sections;
}

/** Text of a section. A top-level id ("4") includes its subsections ("4.1"...). */
export function sectionText(md: string, id: string): string | null {
  const lines = md.split("\n");
  const sections = parseSections(md);
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const start = sections[idx];
  let end = lines.length;
  for (let j = idx + 1; j < sections.length; j++) {
    if (sections[j].level <= start.level) {
      end = sections[j].line - 1;
      break;
    }
  }
  return lines.slice(start.line - 1, end).join("\n");
}

/** Every reference to another section: "section 5.4", "sections 0, 4 and 7", "(2.6)", "in 2.2". */
export function findRefs(md: string): Ref[] {
  const refs: Ref[] = [];
  const add = (n: number, text: string, list: string) => {
    for (const id of list.match(new RegExp(NUM, "g")) ?? []) refs.push({ id, line: n, text: text.trim() });
  };
  for (const { n, text } of proseLines(md)) {
    for (const m of text.matchAll(new RegExp(String.raw`\bsections?\s+((?:${NUM})(?:\s*(?:,|and|to)\s*(?:${NUM}))*)`, "gi"))) add(n, text, m[1]);
    for (const m of text.matchAll(new RegExp(String.raw`\(((?:\d+\.\d+))(?:\s+step\s+\d+)?\)`, "g"))) add(n, text, m[1]);
    for (const m of text.matchAll(new RegExp(String.raw`\bin (\d+\.\d+)\b`, "g"))) add(n, text, m[1]);
  }
  return refs;
}

/** Backticked snake_case names (columns, settings, values) used in the text. */
export function snakeNames(md: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  for (const { n, text } of proseLines(md)) {
    for (const m of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) out.push({ name: m[1], line: n });
  }
  return out;
}

/** All backticked tokens, split on commas, inside the given text (used to read the column and value lists). */
export function backtickedTokens(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (/^[a-z]+(?:_[a-z]+)*$/.test(t)) set.add(t);
    }
  }
  // plain words in the value lists, such as "not_started, in_progress, done, partial"
  for (const m of text.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) set.add(m[1]);
  return set;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Next version label for the kit: YYYY-MM-DD.n, n counts up within a day. */
export function nextVersion(previous: string | null, today: string): string {
  const m = previous ? /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(previous) : null;
  if (m && m[1] === today) return `${today}.${Number(m[2]) + 1}`;
  return `${today}.1`;
}
