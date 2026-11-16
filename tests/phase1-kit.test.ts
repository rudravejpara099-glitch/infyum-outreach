// Checks for phase1/GUIDE-FOR-CLAUDE.md. The guide is a prompt that real users' Claude runs against real
// Instagram accounts, so a bad edit changes live behaviour without failing any other test. These checks catch
// the mistakes that keep happening: broken section references, names that no longer match the Sheet,
// numbers that disagree across files, removed safety rules, and edits nobody recorded.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backtickedTokens, findRefs, parseSections, sectionText, sha256, snakeNames } from "../scripts/kit-lib";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const GUIDE_PATH = "phase1/GUIDE-FOR-CLAUDE.md";
const RAW_URL = "https://raw.githubusercontent.com/rudravejpara099-glitch/infyum-outreach/main/phase1/GUIDE-FOR-CLAUDE.md";
const STAGES = ["Found", "Qualified", "Engaged", "DM sent", "Skipped"];

const guide = read(GUIDE_PATH);
const readme = read("README.md");
const sections = parseSections(guide);
const ids = new Set(sections.map((s) => s.id));

describe("kit structure", () => {
  it("has sections 0 to 11 in order, then Appendix A", () => {
    const top = sections.filter((s) => s.level === 2).map((s) => s.id);
    expect(top).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "A"]);
  });

  it("numbers every subsection without gaps (2.1, 2.2, ...)", () => {
    const seen = new Map<string, number>();
    for (const s of sections.filter((x) => x.level === 3)) {
      const [parent, child] = s.id.split(".");
      const expected = (seen.get(parent) ?? 0) + 1;
      expect(Number(child), `subsection ${s.id} should be ${parent}.${expected}`).toBe(expected);
      seen.set(parent, expected);
    }
    expect([...seen.keys()]).toEqual(["2", "4", "5"]);
  });

  it("lists the hard rules as 1 to 11 with no gaps", () => {
    const start = guide.indexOf("**Hard rules.");
    expect(start, "the 'Hard rules.' paragraph is missing").toBeGreaterThan(-1);
    const end = guide.indexOf("\n---", start);
    const numbers = [...guide.slice(start, end).matchAll(/^(\d+)\. \S/gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("kit references", () => {
  const refs = findRefs(guide);

  it("finds the cross-references (guards against the checker silently matching nothing)", () => {
    expect(refs.length).toBeGreaterThan(20);
  });

  it("every 'section N' / '(N.M)' / 'in N.M' points at a section that exists", () => {
    const broken = refs.filter((r) => !ids.has(r.id)).map((r) => `line ${r.line}: section ${r.id} does not exist`);
    expect(broken).toEqual([]);
  });
});

describe("kit names and values", () => {
  const defined = backtickedTokens([sectionText(guide, "5.2"), sectionText(guide, "5.3")].join("\n"));

  it("every column, setting or value name used is defined in 5.2 or 5.3", () => {
    const unknown = snakeNames(guide)
      .filter((n) => !defined.has(n.name))
      .map((n) => `line ${n.line}: \`${n.name}\` is not defined in 5.2 or 5.3`);
    expect(unknown).toEqual([]);
  });

  it("only uses the five stages", () => {
    const used = [...guide.matchAll(/`stage` = ([A-Z][A-Za-z]*(?: sent)?)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((s) => !STAGES.includes(s))).toEqual([]);
  });

  it("follower ranges stay inside 2,000 to 150,000 and the two defaults are present", () => {
    const ranges = [...guide.matchAll(/(\d{1,3}(?:,\d{3})+) to (\d{1,3}(?:,\d{3})+)/g)].map((m) => [m[1], Number(m[1].replace(/,/g, "")), Number(m[2].replace(/,/g, ""))] as const);
    for (const [label, from, to] of ranges) {
      expect(from, `range starting ${label} is below 2,000`).toBeGreaterThanOrEqual(2000);
      expect(to, `range starting ${label} is above 150,000`).toBeLessThanOrEqual(150000);
    }
    expect(guide).toContain("2,000 to 70,000");
    expect(guide).toContain("10,000 to 30,000");
  });

  it("the daily aim is 35 everywhere it is stated", () => {
    const aims = [...guide.matchAll(/\b(\d+) (?:first messages )?a day\b/g)].map((m) => m[1]);
    expect(aims.length).toBeGreaterThan(0);
    expect(aims.filter((n) => n !== "35")).toEqual([]);
  });

  it("does not mention retired things", () => {
    expect(guide).not.toMatch(/Dhrumit|HANDOFF|COLLAB|\bslab/i);
  });
});

describe("kit agrees with the README and entry files", () => {
  it("README and guide give the same ranges and daily aim", () => {
    for (const fact of ["2,000 to 70,000", "10,000 to 30,000", "150,000", "35 first messages a day"]) {
      expect(readme, `README is missing: ${fact}`).toContain(fact);
    }
  });

  it("the raw guide URL that users paste and schedules use is the same everywhere and the file exists", () => {
    expect(readme).toContain(RAW_URL);
    expect(guide).toContain(RAW_URL);
    expect(existsSync(path.join(root, GUIDE_PATH))).toBe(true);
  });

  it("every phase1/ file named in README or CLAUDE.md exists", () => {
    const named = new Set<string>();
    for (const f of ["README.md", "CLAUDE.md", "phase1/CLAUDE.md"]) {
      for (const m of read(f).matchAll(/phase1\/[A-Za-z0-9_.-]+/g)) named.add(m[0]);
    }
    const missing = [...named].filter((p) => !existsSync(path.join(root, p)));
    expect(missing).toEqual([]);
    expect(read("CLAUDE.md")).toContain(GUIDE_PATH);
    expect(read("phase1/CLAUDE.md")).toContain("GUIDE-FOR-CLAUDE.md");
  });
});

describe("kit scenarios (docs/kit-scenarios.json): the safety behaviours must stay written down", () => {
  const scenarios: { id: string; section: string; expected: string; mustContain: string }[] = JSON.parse(read("docs/kit-scenarios.json"));

  it("has a meaningful set with unique ids", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(25);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  it.each(scenarios.map((s) => [s.id, s] as const))("%s", (_id, s) => {
    const text = sectionText(guide, s.section);
    expect(text, `section ${s.section} not found`).not.toBeNull();
    expect(text, `section ${s.section} no longer says: "${s.mustContain}". Expected behaviour: ${s.expected}`).toContain(s.mustContain);
  });
});

describe("kit change record", () => {
  const lock: { version: string; sha256: string } = JSON.parse(read("docs/kit-lock.json"));

  it("every edit to the guide is recorded", () => {
    expect(
      sha256(guide),
      'The guide changed. Re-read the whole file, run `npm run kit:check`, then record it: npm run kit:lock -- "what changed and why"',
    ).toBe(lock.sha256);
  });

  it("the changelog's newest entry is the locked version", () => {
    const first = /^## (\S+)/m.exec(read("docs/kit-changelog.md"));
    expect(first?.[1]).toBe(lock.version);
  });
});
