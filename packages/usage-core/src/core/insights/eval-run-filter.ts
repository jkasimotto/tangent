import type { NormalizedConversation } from "../conversation-report-types.js";

// Tangent's own eval sandboxes run agents in worktrees under this path convention
// (`~/.tangent/eval/runs/...`). This is a filesystem-convention string match on purpose, not an
// `@tangent/eval` import: usage-core stays pure and dependency-light, and the convention is a
// stable contract regardless of how the eval package's internals evolve.
const EVAL_RUN_PATH_SEGMENT = "/.tangent/eval/";

/**
 * True when a conversation is one of Tangent's own eval-run sandbox sessions rather than the user's
 * real coding work: its repo cwd, repo root, or transcript path runs through the
 * `~/.tangent/eval/runs/...` convention. Insight generators exist to tell the user about their own
 * workflow; scoring an eval sandbox agent's session like an ordinary one would produce findings that
 * describe Tangent's own eval harness back to the user and mislead them about what they actually do
 * day to day, so callers should filter these out before running generators over a window.
 */
export function isEvalRunConversation(conversation: NormalizedConversation): boolean {
  const candidates = [conversation.repo?.cwd, conversation.repo?.root, conversation.transcriptPath];
  return candidates.some((candidate) => Boolean(candidate) && candidate!.includes(EVAL_RUN_PATH_SEGMENT));
}
