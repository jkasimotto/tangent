// The mark is the atomic capture of a moment a user judged an agent's behavior, made in-session
// while the annoyance is fresh (the quality lens) or mined from telemetry after the fact (the
// efficiency lens). It is the connecting artifact between noticing a problem and proving a fix: a
// mark can be promoted into an eval case, and the eval's report becomes the evidence a reviewer
// sees. The shape generalizes `EvalReviewNote` (see ../server/reviews.ts), which already models
// anchored good/bad annotations, from eval artifacts to live conversations.
//
// See docs/superpowers/specs/2026-07-05-mark-loop-design.md for the full design.

/**
 * The transcript provider a mark's anchor points into. Only Claude Code native transcripts are
 * resolvable in phase 1; the union stays literal (not `string`) so adding a provider is a
 * deliberate, type-checked change rather than a silent runtime string.
 */
export type MarkProvider = "claude";

/** Quality marks are a human judgment about a failure; candidate marks are a mined efficiency exemplar. */
export type MarkKind = "failure" | "candidate";

/**
 * A mark's place in the triage-to-fix pipeline. `new` marks are freshly captured and unreviewed;
 * `suggested` marks come from the phase-3 sweep and need confirm-or-dismiss; `triaged` marks have
 * been reviewed by a human; `eval-created` and `fixed` track progress toward a shipped fix;
 * `dismissed` marks are curated out without deletion, preserving the paper trail.
 */
export type MarkStatus = "new" | "suggested" | "triaged" | "eval-created" | "fixed" | "dismissed";

export const markKinds: readonly MarkKind[] = ["failure", "candidate"];
export const markStatuses: readonly MarkStatus[] = ["new", "suggested", "triaged", "eval-created", "fixed", "dismissed"];

/**
 * Points a mark at the conversation moment it describes. `ordinal` is the Usage index's stable
 * per-session message position; it is left unset when the session is not yet indexed at capture
 * time, and resolves lazily on first view rather than blocking capture on an index import.
 */
export type MarkAnchor = {
  provider: MarkProvider;
  sessionId: string;
  conversationId: string;
  transcriptPath: string;
  ordinal?: number;
};

/** The repo and branch a mark was captured against, so marks stay meaningful across many projects. */
export type MarkRepo = {
  root: string;
  branch?: string;
};

/** Forward links from a mark to the eval that proves its fix and the change that shipped it. */
export type MarkLinks = {
  eval: string | null;
  fix: string | null;
};

/**
 * The `tangent.mark.v1` record. One JSON file per mark under `~/.tangent/marks/`, cross-repo by
 * design (see docs/superpowers/specs/2026-07-05-mark-loop-design.md, "Where the data lives").
 */
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

/** Returns whether a value is one of the known mark kinds. */
export function isMarkKind(value: unknown): value is MarkKind {
  return typeof value === "string" && (markKinds as readonly string[]).includes(value);
}

/** Returns whether a value is one of the known mark statuses. */
export function isMarkStatus(value: unknown): value is MarkStatus {
  return typeof value === "string" && (markStatuses as readonly string[]).includes(value);
}

/** Validates that a value is a well-formed MarkAnchor, throwing a specific message otherwise. */
export function assertMarkAnchor(value: unknown): asserts value is MarkAnchor {
  if (!value || typeof value !== "object") throw new Error("Mark anchor must be an object.");
  const anchor = value as Record<string, unknown>;
  if (anchor.provider !== "claude") throw new Error('Mark anchor provider must be "claude".');
  if (typeof anchor.sessionId !== "string" || !anchor.sessionId) throw new Error("Mark anchor requires a non-empty sessionId.");
  if (typeof anchor.conversationId !== "string" || !anchor.conversationId) throw new Error("Mark anchor requires a non-empty conversationId.");
  if (typeof anchor.transcriptPath !== "string" || !anchor.transcriptPath) throw new Error("Mark anchor requires a non-empty transcriptPath.");
  if (anchor.ordinal !== undefined && typeof anchor.ordinal !== "number") throw new Error("Mark anchor ordinal must be a number when present.");
}

/** Validates that a value is a well-formed MarkRepo, throwing a specific message otherwise. */
export function assertMarkRepo(value: unknown): asserts value is MarkRepo {
  if (!value || typeof value !== "object") throw new Error("Mark repo must be an object.");
  const repo = value as Record<string, unknown>;
  if (typeof repo.root !== "string" || !repo.root) throw new Error("Mark repo requires a non-empty root path.");
  if (repo.branch !== undefined && typeof repo.branch !== "string") throw new Error("Mark repo branch must be a string when present.");
}

/** Validates that a value is a well-formed MarkLinks, throwing a specific message otherwise. */
export function assertMarkLinks(value: unknown): asserts value is MarkLinks {
  if (!value || typeof value !== "object") throw new Error("Mark links must be an object.");
  const links = value as Record<string, unknown>;
  if (links.eval !== null && typeof links.eval !== "string") throw new Error("Mark links.eval must be a string or null.");
  if (links.fix !== null && typeof links.fix !== "string") throw new Error("Mark links.fix must be a string or null.");
}

/** Validates that a value is a well-formed tangent.mark.v1 record, throwing a specific message otherwise. */
export function assertMarkRecord(value: unknown): asserts value is MarkRecord {
  if (!value || typeof value !== "object") throw new Error("Mark record must be an object.");
  const record = value as Record<string, unknown>;
  if (record.schema !== "tangent.mark.v1") throw new Error('Mark record must have schema "tangent.mark.v1".');
  if (typeof record.id !== "string" || !record.id) throw new Error("Mark record requires a non-empty id.");
  if (typeof record.at !== "string" || !record.at) throw new Error("Mark record requires a non-empty at timestamp.");
  if (!isMarkKind(record.kind)) throw new Error(`Mark record kind must be one of: ${markKinds.join(", ")}.`);
  assertMarkAnchor(record.anchor);
  assertMarkRepo(record.repo);
  if (typeof record.observed !== "string" || !record.observed) throw new Error("Mark record requires non-empty observed text.");
  if (record.expected !== undefined && typeof record.expected !== "string") throw new Error("Mark record expected must be a string when present.");
  if (record.hypothesis !== undefined && typeof record.hypothesis !== "string") throw new Error("Mark record hypothesis must be a string when present.");
  if (record.quote !== undefined && typeof record.quote !== "string") throw new Error("Mark record quote must be a string when present.");
  if (!isMarkStatus(record.status)) throw new Error(`Mark record status must be one of: ${markStatuses.join(", ")}.`);
  assertMarkLinks(record.links);
}
