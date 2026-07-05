import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ScoringCompare from "./ScoringCompare.svelte";
import type { EvalScoringView } from "./client.js";

afterEach(() => cleanup());

/** Builds a two-column scoring view (baseline vs. one other), the shape a legacy two-variant run produces. */
const twoColumnView: EvalScoringView = {
  caseId: "task",
  baselineKey: "baseline",
  variants: [
    { key: "baseline", variantId: "baseline", label: "baseline", isBaseline: true, totalPoints: 2, maxPoints: 3 },
    { key: "with-search", variantId: "with-search", label: "with-search", isBaseline: false, totalPoints: 3, maxPoints: 3 }
  ],
  criteria: [
    {
      id: "a",
      statement: "loaded skill",
      discriminating: true,
      cells: [
        { variantKey: "baseline", passed: true, reasoning: "did" },
        { variantKey: "with-search", passed: true, reasoning: "did too" }
      ]
    },
    {
      id: "b",
      statement: "ran tests",
      discriminating: true,
      cells: [
        { variantKey: "baseline", passed: false, reasoning: "no" },
        { variantKey: "with-search", passed: true, reasoning: "yes" }
      ]
    }
  ],
  warnings: []
};

describe("ScoringCompare", () => {
  it("renders each criterion with a verdict per column", () => {
    render(ScoringCompare, { view: twoColumnView });
    expect(screen.getByText("loaded skill")).toBeTruthy();
    expect(screen.getByText("ran tests")).toBeTruthy();
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
    expect(screen.getAllByText("✗").length).toBeGreaterThan(0);
  });

  it("renders the total score for each column", () => {
    render(ScoringCompare, { view: twoColumnView });
    expect(screen.getByText("2 / 3 pts")).toBeInTheDocument();
    expect(screen.getByText("3 / 3 pts")).toBeInTheDocument();
  });

  it("marks the baseline column and no other", () => {
    const { container } = render(ScoringCompare, { view: twoColumnView });
    expect(container.querySelectorAll(".scoring-baseline-tag")).toHaveLength(1);
  });

  it("renders warnings as notes", () => {
    render(ScoringCompare, { view: { ...twoColumnView, warnings: ["judge timed out"] } });
    expect(screen.getByText("judge timed out")).toBeInTheDocument();
  });

  it("renders N columns for a run with more than two variants, one column per variant", () => {
    const fourColumnView: EvalScoringView = {
      caseId: "task",
      baselineKey: "root-no-ctx",
      variants: [
        { key: "root-no-ctx", variantId: "root-no-ctx", label: "root-no-ctx", isBaseline: true, totalPoints: 1, maxPoints: 2 },
        { key: "expr-no-ctx", variantId: "expr-no-ctx", label: "expr-no-ctx", isBaseline: false, totalPoints: 2, maxPoints: 2 },
        { key: "root-repo-ctx", variantId: "root-repo-ctx", label: "root-repo-ctx", isBaseline: false, totalPoints: 2, maxPoints: 2 },
        { key: "expr-repo-ctx", variantId: "expr-repo-ctx", label: "expr-repo-ctx", isBaseline: false, totalPoints: 1, maxPoints: 2 }
      ],
      criteria: [{
        id: "x",
        statement: "found the right file",
        discriminating: true,
        cells: [
          { variantKey: "root-no-ctx", passed: false },
          { variantKey: "expr-no-ctx", passed: true },
          { variantKey: "root-repo-ctx", passed: true },
          { variantKey: "expr-repo-ctx", passed: false }
        ]
      }],
      warnings: []
    };
    const { container } = render(ScoringCompare, { view: fourColumnView });
    expect(container.querySelectorAll(".scoring-col-head")).toHaveLength(4);
    expect(container.querySelectorAll(".scoring-side")).toHaveLength(4);
  });

  it("shows absent for a column with no verdict for a criterion", () => {
    const withGap: EvalScoringView = {
      ...twoColumnView,
      criteria: [{ id: "c", statement: "not scored on one side", discriminating: false, cells: [{ variantKey: "baseline", passed: true }, { variantKey: "with-search" }] }]
    };
    render(ScoringCompare, { view: withGap });
    expect(screen.getByText("absent")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    render(ScoringCompare, { view: undefined, loading: true });
    expect(screen.getByText("Loading scoring…")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    render(ScoringCompare, { view: undefined, errorText: "boom" });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
