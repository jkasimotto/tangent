import "./test-setup.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatMetric, MetricDelta } from "./index.js";

describe("metric components", () => {
  it("formats compact token values", () => {
    expect(formatMetric(104000, "tokens")).toBe("104K");
  });

  it("labels lower-is-better negative deltas as favorable", () => {
    render(<MetricDelta label="Tokens" leftLabel="A" rightLabel="B" left={100} right={80} unit="tokens" polarity="lower-is-better" />);
    expect(screen.getByText("-20")).toBeInTheDocument();
  });
});
