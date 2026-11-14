import { describe, expect, it } from "vitest";
import { manualFirstDmError } from "@/lib/domain/manual-first-dm";

const valid = ["A specific profile detail, a gap I noticed, and an easy question. Want me to show you a quick idea? Sunil | INFYUM"];

describe("manual first-DM checks", () => {
  it("accepts one message without a link", () => {
    expect(manualFirstDmError(valid)).toBeNull();
  });

  it("requires exactly one non-empty message under the limit", () => {
    expect(manualFirstDmError([""])).toMatch(/Write the first message/);
    expect(manualFirstDmError([valid[0], valid[0]])).toMatch(/Write the first message/);
    expect(manualFirstDmError(["x".repeat(901)])).toMatch(/900 characters/);
  });

  it("refuses links in the first message", () => {
    expect(manualFirstDmError([`${valid[0]} https://portfolio.infyum.com/sales-funnel`])).toMatch(/links/);
  });
});
