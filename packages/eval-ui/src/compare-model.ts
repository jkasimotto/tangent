import type { EvalCompareArtifactKind, EvalCompareArtifactView, EvalReviews, EvalReviewNote } from "./client.js";

export type AlignedSide = { present: boolean; changed: boolean };
export type AlignedRow = { artifact: EvalCompareArtifactView; a: AlignedSide; b: AlignedSide; identical: boolean };
export type AlignedSection = { kind: EvalCompareArtifactKind; title: string; rows: AlignedRow[]; differs: boolean };

const SECTION_ORDER: { kind: EvalCompareArtifactKind; title: string }[] = [
  { kind: "prompt", title: "Prompts" },
  { kind: "context", title: "Context files" },
  { kind: "code", title: "Changed files" }
];

/** A is the left variant, B the right. A right-only artifact is absent from A; left-only from B. */
function sideFor(artifact: EvalCompareArtifactView, side: "a" | "b"): AlignedSide {
  const present = side === "a" ? artifact.status !== "right-only" : artifact.status !== "left-only";
  // Code carries per-side changed flags (the agent's own edits); other kinds "changed" when the pair differs.
  const changed = artifact.kind === "code" && (artifact.changedLeft !== undefined || artifact.changedRight !== undefined)
    ? (side === "a" ? artifact.changedLeft === true : artifact.changedRight === true)
    : present && artifact.status !== "same";
  return { present, changed };
}

/** One identity row per artifact, spanning both sides, so each kind compares like with like. */
export function buildAlignedSections(artifacts: EvalCompareArtifactView[]): AlignedSection[] {
  return SECTION_ORDER.map(({ kind, title }) => {
    const rows = artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => {
        const a = sideFor(artifact, "a");
        const b = sideFor(artifact, "b");
        return { artifact, a, b, identical: artifact.status === "same" };
      });
    return { kind, title, rows, differs: rows.some((row) => !row.identical) };
  });
}

/** The cache key for one side's rendered file content, so re-expanding never refetches. */
export function diffCacheKey(caseId: string, variantId: string, artifactId: string): string {
  return `${caseId}::${variantId}::${artifactId}`;
}

/** The notes one variant carries for one artifact. */
export function fileNotes(reviews: EvalReviews, caseId: string, variantId: string, artifactId: string): EvalReviewNote[] {
  const review = reviews.variants[`${caseId}/${variantId}`];
  return review ? review.notes.filter((note) => note.artifactId === artifactId) : [];
}

/** Rows that carry at least one note on either side, for the notes-only lens. */
export function rowsWithNotes(section: AlignedSection, reviews: EvalReviews, caseId: string, a: string, b: string): AlignedRow[] {
  return section.rows.filter((row) =>
    fileNotes(reviews, caseId, a, row.artifact.id).length > 0 ||
    fileNotes(reviews, caseId, b, row.artifact.id).length > 0);
}
