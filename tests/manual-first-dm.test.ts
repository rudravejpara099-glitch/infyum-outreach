import { describe, expect, it } from "vitest";
import { manualFirstDmError } from "@/lib/domain/manual-first-dm";

const link = "https://portfolio.infyum.com/sales-funnel";
const valid = ["A specific profile detail.", `I noticed this funnel gap: ${link}`, "How do you handle new enquiries?"];

describe("manual first-DM checks", () => {
  it("accepts three short messages with the campaign link only in part two", () => {
    expect(manualFirstDmError(valid, link)).toBeNull();
  });

  it("requires all three non-empty parts and keeps each under the limit", () => {
    expect(manualFirstDmError([valid[0], "", valid[2]], link)).toMatch(/all three/);
    expect(manualFirstDmError([valid[0], "x".repeat(381), valid[2]], link)).toMatch(/380 characters/);
  });

  it("requires the exact campaign link once in the second message", () => {
    expect(manualFirstDmError([valid[0], "No link yet", valid[2]], link)).toMatch(/campaign link/);
    expect(manualFirstDmError([valid[0], `https://evil.example/?continue=${link}`, valid[2]], link)).toMatch(/campaign link/);
    expect(manualFirstDmError([`${valid[0]} ${link}`, valid[1], valid[2]], link)).toMatch(/campaign link/);
    expect(manualFirstDmError([valid[0], `${valid[1]} ${link}`, valid[2]], link)).toMatch(/campaign link/);
  });
});
