import { describe, expect, it } from "vitest";
import { manualFirstDmError } from "@/lib/domain/manual-first-dm";

const link = "https://portfolio.infyum.com/sales-funnel";

describe("manual first-DM checks", () => {
  it("accepts one to three short messages, with or without the campaign link", () => {
    expect(manualFirstDmError(["A specific profile detail."], link)).toBeNull();
    expect(manualFirstDmError(["A specific profile detail.", "How do you handle new enquiries?"], link)).toBeNull();
    expect(manualFirstDmError(["One", `Two: ${link}`, "Three"], link)).toBeNull();
  });

  it("requires one to three non-empty parts and keeps each under the limit", () => {
    expect(manualFirstDmError([], link)).toMatch(/one to three/);
    expect(manualFirstDmError(["a", "b", "c", "d"], link)).toMatch(/one to three/);
    expect(manualFirstDmError(["a", "", "c"], link)).toMatch(/one to three/);
    expect(manualFirstDmError(["a", "x".repeat(381)], link)).toMatch(/380 characters/);
  });

  it("allows only the campaign link, at most once", () => {
    expect(manualFirstDmError(["a", `https://evil.example/?continue=${link}`], link)).toMatch(/campaign link/);
    expect(manualFirstDmError(["a", "see https://other.example/x"], link)).toMatch(/campaign link/);
    expect(manualFirstDmError([`${link}`, `again ${link}`], link)).toMatch(/campaign link/);
  });
});
