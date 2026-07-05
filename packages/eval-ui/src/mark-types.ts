// View types for the N-way scoring matrix and the marks inbox, split out of client.ts (which was already
// a large grab-bag of view types plus the HTTP client factory) so both stay easy to scan. Re-exported from
// client.ts so every existing `import type {...} from "./client.js"` keeps working unchanged.

// --- N-way scoring matrix (Scoring section: every variant in a case, not just the selected pair) -----

/** One variant column in the N-way scoring matrix. */
export type EvalScoringVariantColumn = {
  key: string;
  variantId: string;
  label: string;
  isBaseline: boolean;
  totalPoints?: number;
  maxPoints?: number;
};

/** One variant's verdict for one criterion. `passed` is undefined when that column has no evaluation data for this criterion. */
export type EvalScoringCell = {
  variantKey: string;
  passed?: boolean;
  reasoning?: string;
};

/** One rubric criterion as a row across every variant column. */
export type EvalScoringCriterion = {
  id: string;
  statement: string;
  /** True when at least two columns have a known verdict for this criterion and they disagree; drives the discriminating-first sort. */
  discriminating: boolean;
  cells: EvalScoringCell[];
};

/** The N-way scoring view for one case: every variant as a column, criteria as rows, baseline flagged. */
export type EvalScoringView = {
  caseId: string;
  baselineKey: string;
  variants: EvalScoringVariantColumn[];
  criteria: EvalScoringCriterion[];
  warnings: string[];
};

// --- Marks inbox (quality/efficiency lens capture, see docs/superpowers/specs/2026-07-05-mark-loop-design.md) ---

/** Only Claude Code native transcripts are resolvable today; kept literal so adding a provider is a deliberate change. */
export type MarkProvider = "claude";

/** Quality marks are a human judgment about a failure; candidate marks are a mined efficiency exemplar. */
export type MarkKind = "failure" | "candidate";

/** A mark's place in the triage-to-fix pipeline. See packages/eval/src/marks/types.ts for the authoritative doc. */
export type MarkStatus = "new" | "suggested" | "triaged" | "eval-created" | "fixed" | "dismissed";

/** Points a mark at the conversation moment it describes. */
export type MarkAnchor = {
  provider: MarkProvider;
  sessionId: string;
  conversationId: string;
  transcriptPath: string;
  ordinal?: number;
};

/** The repo and branch a mark was captured against. */
export type MarkRepo = {
  root: string;
  branch?: string;
};

/** Forward links from a mark to the eval that proves its fix and the change that shipped it. */
export type MarkLinks = {
  eval: string | null;
  fix: string | null;
};

/** The `tangent.mark.v1` record, mirrored from packages/eval/src/marks/types.ts at the UI/client boundary (eval-ui does not import @tangent/eval; see AGENTS.md). */
export type MarkRecord = {
  schema: "tangent.mark.v1";
  id: string;
  at: string;
  kind: MarkKind;
  anchor: MarkAnchor;
  repo: MarkRepo;
  observed: string;
  expected?: string;
  hypothesis?: string;
  quote?: string;
  status: MarkStatus;
  links: MarkLinks;
};

/** Query filters for listing marks. */
export type MarkListFilter = {
  status?: MarkStatus;
  kind?: MarkKind;
};

/** A status/links patch for updating one mark. */
export type MarkUpdatePatch = {
  status?: MarkStatus;
  links?: Partial<MarkLinks>;
};
