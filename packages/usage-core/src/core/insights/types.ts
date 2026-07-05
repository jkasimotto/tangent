/** The suggested category of fix a finding points at, from the remedy table in the mark-loop design doc. */
export type FindingRemedy =
  | "missing-map"
  | "split-or-map-file"
  | "structural-search"
  | "document-command"
  | "document-invocation";

/** The four v1 deterministic finding generators, each a pure function over a window of conversations. */
export type FindingGeneratorName =
  | "info-finding-heavy-sessions"
  | "recurring-long-commands"
  | "re-read-churn-and-hot-files"
  | "failure-retry-loops";

/** One conversation contributing evidence to a finding, paste-ready for `tangent mark --session <id>`. */
export type FindingEvidenceRef = {
  conversationId: string;
  sessionId?: string;
};

/**
 * A single ranked unit of the efficiency lens: one deterministic pattern found in telemetry, with
 * the numbers already computed so the CLI and UI never re-read conversations or re-derive cost.
 * `costTokens` is always an estimate derived from tool-result sizes (providers do not report exact
 * per-tool-call token usage); `costTokensEstimated` exists so callers never forget to label it.
 */
export type Finding = {
  generator: FindingGeneratorName;
  /** Stable human key naming the specific pattern within its generator (a command head, a file path, a session id). */
  subject: string;
  /** Plain-language one-liner with the numbers already in it; no chart required to understand it. */
  title: string;
  costMs: number;
  costTokens: number;
  costTokensEstimated: boolean;
  evidence: FindingEvidenceRef[];
  remedy: FindingRemedy;
  /** Stable hash of generator + subject + repo, used as the park-state key. */
  fingerprint: string;
  /** Repo root the finding was scoped to, if any (findings computed cross-project may leave this unset). */
  repo?: string;
  /** Generator-specific supporting detail (per-file read counts, retry counts, and similar). Free-form by design: each generator surfaces different evidence and there is no shared shape worth forcing. */
  detail?: Record<string, unknown>;
};
