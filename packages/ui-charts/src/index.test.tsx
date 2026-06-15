import "./test-setup.js";
import { describe, expect, it } from "vitest";

import { rowsToCsv } from "./index.js";

describe("chart data export", () => {
  it("exports rows as csv", () => {
    expect(rowsToCsv([{ label: "tokens", value: 10 }])).toBe("\"label\",\"value\"\n\"tokens\",\"10\"");
  });
});
