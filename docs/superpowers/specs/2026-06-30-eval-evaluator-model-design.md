# Eval Evaluator Model — Design

**Status:** approved (2026-06-30)
**Package:** `@tangent/eval` (+ `@tangent/eval-ui` for display)

## Problem

The eval compare screen shows what two agent variants produced (diff, conversation, time, tokens, files read), but scoring is manual: a human reads both and assigns a verdict. We want objective, repeatable scoring against a per-eval rubric. Example criterion: "Loaded the expression-functions skill" → +1 point. The judge is another model that reads each variant's code changes and its conversation, and decides each criterion pass/fail.

## Decisions (locked)

1. **Judging mechanism:** the evaluator model judges *every* criterion. No deterministic rule engine. The judge reads the diff + transcript and returns pass/fail with brief reasoning per criterion.
2. **Rubric home:** in the eval definition (`eval.json`), version-controlled, applied to every variant of the eval so A and B are scored identically.
3. **Trigger:** automatically at collection. Every collected variant is scored as part of the run pipeline; scores are present when the compare screen opens.
4. **Evaluator model:** required per-eval choice. No default. If an eval defines an `evaluator` block, it must name the model. Evals without the block are not scored (backward compatible).

## Data model

### Spec (`packages/eval/src/types/spec.ts`)

Add an evaluator block at the **spec level** (one rubric per eval):

```ts
export type EvalCriterion = {
  id: string;          // stable kebab-case key, unique within the rubric
  statement: string;   // what the judge decides true/false, e.g. "Loaded the expression-functions skill before editing"
  points?: number;     // positive integer, default 1
};

export type EvalEvaluatorSpec = {
  model: string;       // required; e.g. "claude-opus-4-8". The judge, not the agent under test.
  criteria: EvalCriterion[];  // non-empty
};

export type EvalSpec = {
  schema: "eval.spec.v1";
  name: string;
  defaults?: EvalDefaults;
  evaluator?: EvalEvaluatorSpec;   // NEW
  cases: EvalCaseSpec[];
};
```

Validation in `core/config.ts` `loadEvalSpec`: when `evaluator` is present, `model` must be a non-empty string and `criteria` must be non-empty; every criterion needs a non-empty `id` (unique) and `statement`; `points`, if given, must be a positive integer. Validation failure throws the same way other spec errors do.

### Manifest (`packages/eval/src/types/run.ts`)

`collectEval` works from the persisted `EvalRunManifest`. The manifest already carries the full spec (`EvalRunManifest.spec?: EvalSpec`), so collection reads `manifest.spec?.evaluator` directly. No new manifest field and no prepare-path change are required; adding `evaluator` to `EvalSpec` is sufficient for it to be persisted onto the manifest.

### Verdict sidecar (`eval.evaluation.v1`)

Written next to `metrics.json` in the variant dir as `evaluation.json`:

```ts
export type EvalCriterionVerdict = {
  id: string;
  statement: string;
  points: number;        // resolved (default applied)
  passed: boolean;
  reasoning: string;     // one or two sentences from the judge
};

export type EvalEvaluation = {
  schema: "eval.evaluation.v1";
  caseId: string;
  variantId: string;
  model: string;
  evaluatedAt: string;   // ISO; stamped by the caller, never Date.now() inside pure code
  criteria: EvalCriterionVerdict[];
  totalPoints: number;   // sum of points where passed
  maxPoints: number;     // sum of all points
  warnings: string[];    // judge call or parse failures; non-empty means scores may be absent/partial
};
```

## Components

### `core/transcript.ts` (NEW, small shared helper)

Lifts the existing "load usage dataset + conversationReport" reconstruction out of `server/conversation-view.ts` into core so both the server view and the judge use one implementation (correct layering: core, not server).

- `reconstructVariantConversations(variant): Promise<{ conversations: NormalizedConversation[]; notes: string[] }>` — wraps `loadUsageDatasetFromIndex` + `conversationReport` per conversation id from the variant's metrics, with the per-conversation try/catch that today lives in `variantConversationsView`.
- `server/conversation-view.ts` is refactored to consume this helper (no behavior change; its tests stay green).
- A `formatTranscriptForJudge(conversations, worktree): string` renders a compact plain-text transcript: per turn, the role, the assistant text, optional thinking, and each tool call as `name + relativized inputPreview` (reusing the worktree-relativization already added). Bounded length: cap the serialized transcript (e.g. ~12k chars) and note truncation, so a long run can't blow the judge prompt.

### `core/evaluator.ts` (NEW)

`evaluateVariant(manifest, variant, evaluator, now): Promise<EvalEvaluation>`:
1. Build the **diff**: `gitText(variant.worktree, ["diff", variant.baseCommit, implementationCommit])` via `@tangent/repo/git`. Cap very large diffs and note truncation.
2. Build the **transcript** via `core/transcript.ts`.
3. Compose the judge prompt (rubric + diff + transcript + strict-JSON output contract).
4. Call the judge via `runners/judge.ts`.
5. Parse the JSON verdict; map to `EvalCriterionVerdict[]`, applying the `points` default and computing `totalPoints` / `maxPoints`.
6. On judge-call failure or unparseable output (after one repair retry), return an `EvalEvaluation` with `warnings` populated and `criteria: []` / zero totals. Never throw into the collection loop.

### `runners/judge.ts` (NEW)

A single non-interactive model call, reusing the same `claude --print` + `runProcess` path as `runners/claude-cli.ts` but without agent semantics: prompt in, result text out, `--model <judge model>`. Exposes `runJudge({ model, prompt, cwd, env, signal }): Promise<string>`. The verdict parser is a separate pure function so it is unit-testable without spawning a process.

### Collection hook (`core/metrics.ts` `collectEval`)

After each variant's `metrics.json` is written (line 18), if `manifest.evaluator` is set, call `evaluateVariant` and write `evaluation.json` to the variant dir. Wrapped so an evaluation failure records a warning and continues to the next variant; collection still completes and writes `report.json`.

### Server (`packages/eval/src/server`)

- A `readVariantEvaluation(manifest, variant)` reader (mirrors `readVariantMetricsView`) returns the parsed `evaluation.json` or null.
- Surface the score in the existing compare/run-detail view: add `evaluation?: EvalEvaluationView` to the per-variant view (`server/types.ts` + `eval-ui/src/client.ts`), carrying `totalPoints`, `maxPoints`, `model`, the per-criterion verdicts, and `warnings`. `eval-ui` keeps its own serializable copy of the type (it must not import `@tangent/eval`).

### Compare UI (`packages/eval-ui/src/App.svelte` + a new component)

- **Score chip** on each variant card: `7 / 10 pts`, beside the files-read metric, so the headline number is comparable at a glance. Absent when the variant has no evaluation.
- **Scoring section** (collapsible, like Conversations), a new `ScoringCompare.svelte`: each criterion as a row with A and B ✓/✗ side by side and the judge's reasoning, plus any warnings as notes. This is the payoff: see exactly which criteria each agent passed.

## Flow

```
prepare:  spec.evaluator ──► manifest.evaluator (persisted)
collect:  for each variant ──► metrics.json
                          └─► if manifest.evaluator:
                                diff + transcript ──► judge model ──► evaluation.json
compare:  cards show "N / M pts"; Scoring section shows per-criterion A vs B
```

## Error handling

- No `evaluator` block → no judge call, no `evaluation.json`, UI shows no score. Existing runs and evals are unaffected.
- Judge process fails, times out, or returns unparseable JSON (after one repair retry) → `evaluation.json` with `warnings`, zero scores; collection continues.
- Transcript/diff missing (uncollected or transcript gone) → judge still runs with whatever is available; the absence is noted in the prompt and in `warnings`.
- Re-running `collect` re-evaluates and overwrites `evaluation.json` (idempotent given the same inputs and model).

## Testing

- **Verdict parser** (pure): valid JSON → verdicts; malformed JSON → repair path; still-malformed → warnings + zero scores; missing/extra criteria handled.
- **Transcript serializer** (pure): turns and tool calls render compactly; paths relativized; truncation noted at the cap.
- **Config validation:** evaluator block missing model, empty criteria, duplicate ids, non-positive points each rejected; a valid block accepted.
- **points/score math:** default applied; `totalPoints`/`maxPoints` correct.
- **Collection integration:** a manifest with an `evaluator` block and a stubbed judge writes `evaluation.json`; a manifest without one writes none; a judge that throws yields a warning sidecar and does not fail collection.
- **Server + UI:** the compare endpoint surfaces the score; the card renders `N / M pts`; the Scoring section renders A/B verdicts. The judge model call is stubbed throughout — tests never spend live tokens.

## Out of scope

- No on-demand "Evaluate" button (trigger is automatic at collection).
- No deterministic rule criteria (the judge decides everything).
- No partial credit within a criterion (binary pass/fail; full points or zero).
- No cross-variant comparative judging (each variant scored independently against the same rubric, then compared by total).
