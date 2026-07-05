import { describe, expect, it } from "vitest";
import { buildAlignedSections, diffCacheKey, fileNotes, rowsWithNotes, scoringCell, scoringTotalLabel } from "./compare-model.js";
import type { EvalCompareArtifactView, EvalReviews, EvalScoringCriterion, EvalScoringVariantColumn } from "./client.js";

const artifacts: EvalCompareArtifactView[] = [
  { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
  { id: "context:AGENTS.md", kind: "context", path: "AGENTS.md", label: "AGENTS.md", status: "right-only" },
  { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: false }
];

describe("buildAlignedSections", () => {
  it("groups by kind in prompt/context/code order with titles", () => {
    const sections = buildAlignedSections(artifacts);
    expect(sections.map((s) => s.kind)).toEqual(["prompt", "context", "code"]);
    expect(sections.map((s) => s.title)).toEqual(["Prompts", "Context files", "Changed files"]);
  });

  it("marks a same prompt identical and not differing", () => {
    const prompt = buildAlignedSections(artifacts)[0];
    expect(prompt.rows[0].identical).toBe(true);
    expect(prompt.differs).toBe(false);
    expect(prompt.rows[0].a.present).toBe(true);
    expect(prompt.rows[0].b.present).toBe(true);
  });

  it("places a right-only context file on B only and flags the section as differing", () => {
    const ctx = buildAlignedSections(artifacts)[1];
    expect(ctx.rows[0].a.present).toBe(false);
    expect(ctx.rows[0].b.present).toBe(true);
    expect(ctx.differs).toBe(true);
  });

  it("uses per-side changed flags for code, not the pair status", () => {
    const code = buildAlignedSections(artifacts)[2];
    expect(code.rows[0].a.changed).toBe(true);
    expect(code.rows[0].b.changed).toBe(false);
    expect(code.rows[0].identical).toBe(false);
  });
});

describe("diffCacheKey", () => {
  it("is stable per case+variant+artifact", () => {
    expect(diffCacheKey("task", "repo", "code:src/foo.ts")).toBe("task::repo::code:src/foo.ts");
  });
});

describe("fileNotes / rowsWithNotes", () => {
  const reviews: EvalReviews = {
    schema: "eval.reviews.v1",
    variants: {
      "task/empty": { notes: [{ id: "n1", artifactId: "code:src/foo.ts", artifactLabel: "src/foo.ts", line: 3, snippet: "x", sentiment: "bad", text: "off by one", ts: 1 }] }
    }
  };

  it("returns a variant's notes for one artifact", () => {
    expect(fileNotes(reviews, "task", "empty", "code:src/foo.ts")).toHaveLength(1);
    expect(fileNotes(reviews, "task", "repo", "code:src/foo.ts")).toHaveLength(0);
  });

  it("keeps only rows annotated on either side", () => {
    const code = buildAlignedSections(artifacts)[2];
    // empty has a note on src/foo.ts; either ordering of the two variants keeps the row.
    expect(rowsWithNotes(code, reviews, "task", "empty", "repo")).toHaveLength(1);
    expect(rowsWithNotes(code, reviews, "task", "repo", "empty")).toHaveLength(1);
    // a section whose rows carry no notes on either side drops to empty.
    const prompts = buildAlignedSections(artifacts)[0];
    expect(rowsWithNotes(prompts, reviews, "task", "empty", "repo")).toHaveLength(0);
  });
});

describe("scoringCell / scoringTotalLabel", () => {
  const criterion: EvalScoringCriterion = {
    id: "read-docs",
    statement: "Read docs first",
    discriminating: true,
    cells: [
      { variantKey: "baseline", passed: false, reasoning: "grepped instead" },
      { variantKey: "v2", passed: true, reasoning: "read docs/index.md" }
    ]
  };

  it("finds a column's cell by key, across any number of columns", () => {
    expect(scoringCell(criterion, "baseline")?.passed).toBe(false);
    expect(scoringCell(criterion, "v2")?.passed).toBe(true);
  });

  it("returns undefined for a column key with no cell", () => {
    expect(scoringCell(criterion, "v3")).toBeUndefined();
  });

  it("formats a column's total-points label when both totals are known", () => {
    const column: EvalScoringVariantColumn = { key: "baseline", variantId: "baseline", label: "baseline", isBaseline: true, totalPoints: 2, maxPoints: 3 };
    expect(scoringTotalLabel(column)).toBe("2 / 3 pts");
  });

  it("returns undefined when a column has no evaluation totals", () => {
    const column: EvalScoringVariantColumn = { key: "v4", variantId: "v4", label: "v4", isBaseline: false };
    expect(scoringTotalLabel(column)).toBeUndefined();
  });
});
