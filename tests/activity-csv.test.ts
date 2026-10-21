import { expect, it } from "vitest";
import { csvCell } from "@/lib/ui/csv";
it("quotes activity cells without changing ordinary text or newlines inside text", () => {
  expect(csvCell(null)).toBe('""');
  expect(csvCell('Coach "Maya", NYC\nsecond line')).toBe('"Coach ""Maya"", NYC\nsecond line"');
  expect(csvCell(42)).toBe('"42"');
});
it("keeps formulas inert even with leading whitespace", () => {
  for (const value of ['=HYPERLINK("https://example.test")', '+1+2', '-1+2', '@SUM(1)', '\t=1+2', '\r=1+2', ' =1+2', '\uFEFF=1+2']) {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  }
});
