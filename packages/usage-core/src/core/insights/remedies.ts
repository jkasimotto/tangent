import type { FindingRemedy } from "./types.js";

/**
 * Human-readable remedy sentence for each finding remedy category, shared verbatim by
 * `tangent usage insights` and the Insights view in the Usage UI so both surfaces describe a
 * remedy identically. Keyed by the remedy category assigned by the generator that produced the
 * finding (see the remedy table in the mark-loop design doc).
 */
export const FINDING_REMEDY_LABELS: Record<FindingRemedy, string> = {
  "missing-map": "missing map: add a CLAUDE.md pointer or docs index entry",
  "split-or-map-file": "context too big to retain in one file: split it, or summarize it in CLAUDE.md",
  "structural-search": "missing tool: structural search instead of grep/glob chains",
  "document-command": "document the correct scoped invocation in CLAUDE.md, or cache the result",
  "document-invocation": "document the correct invocation so the agent stops guessing"
};
