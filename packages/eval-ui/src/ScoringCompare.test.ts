import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ScoringCompare from "./ScoringCompare.svelte";

afterEach(() => cleanup());

const left = {
  model: "m",
  totalPoints: 2,
  maxPoints: 3,
  warnings: [],
  criteria: [
    { id: "a", statement: "loaded skill", points: 2, passed: true, reasoning: "did" },
    { id: "b", statement: "ran tests", points: 1, passed: false, reasoning: "no" }
  ]
};
const right = { ...left, totalPoints: 3, criteria: left.criteria.map((c) => ({ ...c, passed: true })) };

describe("ScoringCompare", () => {
  it("renders each criterion with A and B verdicts", () => {
    render(ScoringCompare, { left, right, leftLabel: "A", rightLabel: "B" });
    expect(screen.getByText("loaded skill")).toBeTruthy();
    expect(screen.getByText("ran tests")).toBeTruthy();
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
  });

  it("renders the total score for each side", () => {
    render(ScoringCompare, { left, right, leftLabel: "A", rightLabel: "B" });
    expect(screen.getByText("2 / 3 pts")).toBeInTheDocument();
    expect(screen.getByText("3 / 3 pts")).toBeInTheDocument();
  });

  it("renders a fail glyph for a criterion the left side did not pass", () => {
    render(ScoringCompare, { left, right, leftLabel: "A", rightLabel: "B" });
    expect(screen.getAllByText("✗").length).toBeGreaterThan(0);
  });

  it("renders warnings as notes", () => {
    const withWarning = { ...left, warnings: ["judge timed out"] };
    render(ScoringCompare, { left: withWarning, right, leftLabel: "A", rightLabel: "B" });
    expect(screen.getByText("judge timed out")).toBeInTheDocument();
  });
});
