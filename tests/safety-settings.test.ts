import { expect, it } from "vitest";
import { DEFAULT_SAFETY, parseSafetySettings, safetyFromForm } from "@/lib/domain/safety-settings";

const form = { dayStartHour: "8", dayEndHour: "20", followsCap: "10", likesCap: "50", commentsCap: "20", dmsCap: "15" };

it("defaults when nothing or junk is saved", () => {
  expect(parseSafetySettings(null)).toEqual(DEFAULT_SAFETY);
  expect(parseSafetySettings("not json")).toEqual(DEFAULT_SAFETY);
  expect(parseSafetySettings(JSON.stringify({ dayStartHour: 20, dayEndHour: 8 }))).toEqual(DEFAULT_SAFETY);
});

it("saves and reads back edited hours and caps", () => {
  const parsed = safetyFromForm(form);
  if ("error" in parsed) throw new Error(parsed.error.message);
  expect(parsed.safety).toEqual({ dayStartHour: 8, dayEndHour: 20, caps: { follows: 10, likes: 50, comments: 20, dms: 15 } });
  expect(parseSafetySettings(JSON.stringify(parsed.safety))).toEqual(parsed.safety);
});

it("refuses bad numbers and an end hour before the start hour", () => {
  expect(safetyFromForm({ ...form, likesCap: "-1" })).toMatchObject({ error: { field: "likesCap" } });
  expect(safetyFromForm({ ...form, dmsCap: "abc" })).toMatchObject({ error: { field: "dmsCap" } });
  expect(safetyFromForm({ ...form, dayEndHour: "8" })).toMatchObject({ error: { field: "dayEndHour" } });
});
