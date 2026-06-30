import { expect, test } from "vitest";
import { formatBuiltAtAbsolute, formatUpdatedLabel } from "./relative-time.js";

const builtAt = "2026-06-25T12:00:00.000Z";

test("formatUpdatedLabel crosses the just-now / minute / hour / day boundaries", () => {
  /** Label for `builtAt` offset by `ms` milliseconds. */
  const at = (ms: number): string => formatUpdatedLabel(builtAt, new Date(Date.parse(builtAt) + ms));
  expect(at(0)).toBe("Updated just now");
  expect(at(59_000)).toBe("Updated just now");
  expect(at(60_000)).toBe("Updated 1m ago");
  expect(at(4 * 60_000)).toBe("Updated 4m ago");
  expect(at(60 * 60_000)).toBe("Updated 1h ago");
  expect(at(3 * 60 * 60_000)).toBe("Updated 3h ago");
  expect(at(24 * 60 * 60_000)).toBe("Updated 1d ago");
  expect(at(2 * 24 * 60 * 60_000)).toBe("Updated 2d ago");
});

test("formatUpdatedLabel is safe on an unparseable stamp", () => {
  expect(formatUpdatedLabel("not-a-date")).toBe("Updated just now");
});

test("formatBuiltAtAbsolute renders a Built <date time> stamp", () => {
  const date = new Date(builtAt);
  /** Zero-pad a number to two digits for the expected stamp. */
  const pad = (value: number): string => String(value).padStart(2, "0");
  const expected = `Built ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  expect(formatBuiltAtAbsolute(builtAt)).toBe(expected);
  expect(formatBuiltAtAbsolute("not-a-date")).toBe("");
});
