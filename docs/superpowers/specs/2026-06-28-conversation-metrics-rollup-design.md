# Conversation Metrics Rollup — Design

Date: 2026-06-28
Status: Approved design, pending implementation plan

## Problem

At the end of a working day, the user wants to learn how well their coding-agent
sessions went so they can improve their harness. The headline question is "how
many times did I have to correct the agent?" and its inverse, "how often did the
agent get it right first time?" Today there is no way to get these numbers from
Tangent's Usage data.

## Goal

Let the user hand-pick conversations in the Usage UI and roll up a small set of
"headline" agent-quality metrics for that selection, computed by running Haiku as
a judge over the conversations. Keep the footprint small: one new capability in an
existing package, one API route, and a minimal UI overlay. No new view, no new
package.

Scope is deliberately narrow ("headline only"): correction cycles and first-pass
success. The broader metric suite from the source brief (cost per task, context
ratio, trajectory, intervention location, verification coverage, failure
root-cause) is explicitly out of scope for this version.

## Key insight

Corrections are visible in the **user's** messages alone ("no, do X instead",
"that's wrong", "revert that", "I meant Y"). The agent's output is implied by how
the user redirects it. So the judge only needs the ordered user messages, never
the agent transcripts. This is both cheaper (agent messages are far too long to
send) and aligns with how `@tangent/rollup` already extracts user-only input. The
result is a small generalization of rollup, not a new input layer.

## Non-goals

- No per-task segmentation within a conversation. The unit is the whole
  conversation.
- No reading of assistant/tool messages.
- No additional metrics beyond correction count and first-pass success.
- No new top-level UI view or route; the UI is an overlay on the existing gallery.
- No new package; this extends `@tangent/rollup`.

## Architecture

Approach: add a "metrics" capability inside `@tangent/rollup`, parallel to the
existing prose-notes capability. Reuse what already works:

- Reuse the user-only message extraction, the `claude-cli` runner with
  `--json-schema` structured output, the ledger (for caching), and artifact
  writing.
- New: a metrics prompt, a metrics JSON schema, an SDK function, one API route,
  and the UI overlay.

Rejected alternatives:

- New sibling package `@tangent/conversation-metrics`: re-implements selection,
  ledger, and runner wiring that rollup already has, which the repo's
  "do not duplicate" rules forbid.
- Run the agent directly from the usage server: scatters agent-running logic into
  usage, loses ledger caching, reinvents structured-output parsing.

## Data shape and definitions

Unit: per conversation.

Per-conversation result:

```
{
  conversationId: string,
  correctionCount: number,
  corrections: [{ quote: string, why: string }],  // evidence for auditing the judgment
  firstPass: boolean                               // === (correctionCount === 0)
}
```

Aggregate over the selected set:

```
{
  conversationsAnalyzed: number,
  totalCorrections: number,
  firstPassRate: number   // share of analyzed conversations with zero corrections
}
```

Definitions the judge applies:

- **Correction**: a user message that rejects, redirects, or fixes what the agent
  just did. Not a correction: a new task, a normal next step, or added detail.
- **First-pass success** (per conversation): zero corrections.
- **First-pass rate** (aggregate): share of analyzed conversations with zero
  corrections. This is the brief's headline metric.

Evidence (`quote` + `why`) is required because these judgment metrics can be
wrong; evidence lets the user trust or override a number, and is where the actual
learning lives.

## Engine

New SDK function in `@tangent/rollup`, alongside `processRollup`:

```
processMetrics({ conversationIds, repo, runner? }) -> { perConversation[], aggregate }
```

Per conversation, processed in parallel with a small concurrency cap:

1. Build input: pull the visible user messages for the conversation in order
   (`dataset.messages.visible({ conversationId })`), the same path rollup uses,
   keyed by explicit ids instead of a date period. Agent transcripts are never
   read.
2. Check the ledger: fingerprint the conversation by its user-message content
   (reuse `hashObject`). A matching fingerprint returns the cached metrics; new or
   changed conversations are analyzed.
3. Run Haiku: the existing `claude-cli` runner with `--json-schema`, model
   defaulting to Haiku, fed `metricsPrompt(userMessages)` and `metricsJsonSchema`
   (`correctionCount` + `corrections[{quote, why}]`). Structured output returns
   validated JSON.
4. Persist: cache the per-conversation metrics JSON under
   `artifacts/metrics/<conversationId>/` and append a metrics ledger line. A
   conversation that errors is recorded as failed (reuse rollup's
   `previously-failed` reason) and surfaced in results without crashing the batch.

Then compute the aggregate from the per-conversation results and return both.

The metrics prompt is the one piece of real judgment design: read the ordered
user messages, flag each that rejects/redirects/fixes the agent (vs. a new task or
next step), quote the exact text, and say why. Cheap because it is user messages
only.

## API

One new route on the usage server, following the existing `/api/usage/*` pattern:

```
POST /api/usage/metrics/rollup
  body: { conversationIds: string[] }
  -> { perConversation[], aggregate }
```

POST because the id list can be long and the call triggers work. Cached
conversations return instantly; only changed or new ones invoke Haiku, so
re-running a selection is cheap. The handler calls `processMetrics` from
`@tangent/rollup`.

## UI

Minimal additions to the existing `App.svelte` gallery (browse mode):

- A checkbox on each session card. Selection state is a `Set<id>`.
- A small action bar that appears once at least one card is selected:
  "Roll up metrics (N)" plus a clear button.
- Clicking POSTs the selected ids, shows a spinner, then renders a compact results
  panel: an aggregate header (`firstPassRate`, total corrections) and a
  per-conversation row list (title, correction count). Expanding a row shows the
  `quote`/`why` evidence.

No new view and no routing; the results are an overlay panel over the gallery.
The change must be made and verified through `tangent ui`, not the standalone
usage app, per the repo's UI rules.

## Validation

- `npm run check`, `npm run test`, `npm run governance`, `npm run build`.
- New unit tests for `processMetrics` (with an injected runner test double, as
  `processRollup` already supports), covering: correction counting, ledger cache
  hit on unchanged input, and failed-conversation handling.
- Verify the UI through a `tangent ui` instance (worktree dev instance), not the
  per-app surface.

## Docs to update on implementation

- `packages/rollup/docs/public-api.md` and `docs/index.md` (new SDK export).
- `packages/rollup/docs/architecture.md` (metrics capability alongside notes).
- Usage server route list if one is documented.
