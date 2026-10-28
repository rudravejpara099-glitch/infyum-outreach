import { describe, expect, it } from "vitest";
import { parseFit, fitPrompt } from "@/lib/domain/fit-score";
import { scoreFit } from "@/lib/services/fit-score";

describe("fit score", () => {
  it("reads a clean answer and tolerates a code fence", () => {
    expect(parseFit('{"score": 72, "reason": "Sells coaching with a booking link."}')).toEqual({ score: 72, reason: "Sells coaching with a booking link." });
    expect(parseFit('```json\n{"score": 40.4, "reason": "Thin offer"}\n```')).toEqual({ score: 40, reason: "Thin offer" });
  });
  it("rejects anything that is not a score from 0 to 100", () => {
    for (const bad of ["", "not json", '{"score": "high"}', '{"score": 140}', '{"score": -1}', "[1]", "null"]) expect(parseFit(bad)).toBeNull();
  });
  it("puts what we know into the prompt and caps long notes", () => {
    const p = fitPrompt({ handle: "demo", followers: 5000, niche: "credit", notes: "x".repeat(5000) });
    expect(p).toContain("@demo"); expect(p).toContain("5000"); expect(p.length).toBeLessThan(1800);
  });
  it("retries once when the first answer is unreadable, then gives up", async () => {
    let calls = 0;
    const flaky = { async complete() { calls++; return calls === 1 ? "sure!" : '{"score": 65, "reason": "ok"}'; } };
    expect(await scoreFit(flaky, { handle: "a", followers: 1, niche: "", notes: "" })).toEqual({ score: 65, reason: "ok" });
    expect(calls).toBe(2);
    const broken = { async complete() { return "nope"; } };
    expect(await scoreFit(broken, { handle: "a", followers: 1, niche: "", notes: "" })).toBeNull();
  });
});
