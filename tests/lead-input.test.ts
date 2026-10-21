import { describe, expect, it } from "vitest";
import { parseLeadCsv, parsePastedHandles, normalizeHandle, MAX_LEAD_FILE_BYTES } from "@/lib/ui/lead-input";

describe("lead input", () => {
  it("keeps paste behavior and normalizes handles without accepting arbitrary links", () => {
    expect(parsePastedHandles("@One, TWO\nthree")).toEqual(["one", "two", "three"]);
    expect(normalizeHandle("https://www.instagram.com/Example/?hl=en")).toBe("example");
    for (const value of [".", "..", "bad name", "x".repeat(31), "https://evil.com/a", "https://instagram.com/p/abc", "https://instagram.com/a/b"]) expect(normalizeHandle(value)).toBeNull();
  });
  it("accepts BOM, quoted columns, escaped quotes and CRLF without importing other columns", () => {
    expect(parseLeadCsv('\ufeffName,Instagram username,Notes\r\n"Team, one",@ONE,"He said ""hi"""\r\nOther,TWO,ok')).toEqual(["@ONE", "TWO"]);
  });
  it("supports one-column files with or without a header and profile URLs", () => {
    expect(parseLeadCsv("username\none\ntwo\n")).toEqual(["one", "two"]);
    expect(parseLeadCsv("@one\nhttps://instagram.com/two/\n")).toEqual(["@one", "https://instagram.com/two/"]);
    expect(parseLeadCsv("Instagram URL,name\nhttps://instagram.com/one/,One")).toEqual(["https://instagram.com/one/"]);
  });
  it("refuses ambiguous columns, malformed quotes and uneven rows before any import", () => {
    for (const csv of ['name,email\nOne,a@example.com', 'username,handle\none,two', 'username,name\none', 'username\n"unfinished', 'username\n"one"oops', 'username\none"two']) expect(() => parseLeadCsv(csv)).toThrow();
  });
  it("does not invent leads from blank or header-only input and bounds upload work", () => {
    expect(parseLeadCsv("\n\r\n")).toEqual([]);
    expect(parseLeadCsv("username\n")).toEqual([]);
    expect(MAX_LEAD_FILE_BYTES).toBe(500_000);
    expect(() => parseLeadCsv("x".repeat(MAX_LEAD_FILE_BYTES + 1))).toThrow(/500/);
  });
});
