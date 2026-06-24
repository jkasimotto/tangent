import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Human review of eval results: per-variant inline good/bad notes anchored to result lines, plus an
// overall verdict. Persisted as one `reviews.json` in the run dir (colocated with the run, keyed by
// `${caseId}/${variantId}`) so reviews survive reloads and travel with the run. The note carries its
// line's text as `snippet` so the Compare view renders without re-reading any artifact.

export type EvalReviewSentiment = "good" | "bad";
export type EvalVerdictSentiment = "like" | "dislike" | "mixed";

export type EvalReviewNote = {
  id: string;
  artifactId: string;
  artifactLabel: string;
  // A note anchors to a line block: `line` is the first line, `endLine` the last (omitted/equal for a
  // single line). `snippet` carries the block's text so Compare renders without re-reading the artifact.
  line: number;
  endLine?: number;
  snippet: string;
  sentiment: EvalReviewSentiment;
  text: string;
  ts: number;
};

export type EvalVariantReview = {
  // `sentiment` is the at-a-glance verdict; `score` is an optional 0-10 rating for ranking configs.
  verdict?: { sentiment: EvalVerdictSentiment; text?: string; score?: number };
  notes: EvalReviewNote[];
};

export type EvalReviews = {
  schema: "eval.reviews.v1";
  variants: Record<string, EvalVariantReview>;
};

/** An empty reviews document. */
function emptyReviews(): EvalReviews {
  return { schema: "eval.reviews.v1", variants: {} };
}

/** Path to a run's reviews file. */
function reviewsPath(runDir: string): string {
  return path.join(runDir, "reviews.json");
}

/** Reads a run's reviews, returning an empty document when none exists or it is unreadable. */
export async function readReviews(runDir: string): Promise<EvalReviews> {
  try {
    const parsed = JSON.parse(await readFile(reviewsPath(runDir), "utf8")) as EvalReviews;
    if (parsed?.schema === "eval.reviews.v1" && parsed.variants && typeof parsed.variants === "object") return parsed;
  } catch {
    // Missing or malformed: fall through to an empty document.
  }
  return emptyReviews();
}

/** Writes a run's reviews, normalizing to the schema shape, and returns what was stored. */
export async function writeReviews(runDir: string, input: EvalReviews): Promise<EvalReviews> {
  const value: EvalReviews = {
    schema: "eval.reviews.v1",
    variants: input?.variants && typeof input.variants === "object" ? input.variants : {}
  };
  await mkdir(runDir, { recursive: true });
  await writeFile(reviewsPath(runDir), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
