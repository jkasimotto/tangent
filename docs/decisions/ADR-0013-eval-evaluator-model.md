# ADR-0013 LLM Judge Scoring for Eval Variants

Date: 2026-06-30

## Context

Comparing two eval variants by reading diffs and transcripts manually does not scale. A structured rubric per eval, scored automatically at collection time, lets the UI surface pass/fail verdicts for every criterion without human review of each run. The rubric must travel with the eval so it is version-controlled alongside the task prompt and agent config.

Key design choices to record:

- **Judge vs. deterministic rule engine.** The criteria that matter most in coding-agent evals (e.g. "loaded the right skill before editing", "avoided debug prints", "ran the test suite") cannot be reliably detected by grep or AST analysis, because they depend on the agent's visible behavior over a full transcript and diff. An LLM judge is the only practical scorer.
- **Binary scoring.** Partial credit adds judge prompt complexity and evaluation inconsistency with little benefit at this scale. Each criterion earns its full point allotment or zero.
- **Required per-eval model.** Omitting the judge model from the spec would force a global default that silently changes eval results when the default changes. The model must be declared explicitly in the spec.
- **Scoring at collection.** Running the judge inline during agent execution would complicate the runner and mix scoring latency with agent latency. Collection is already the post-run aggregation step, so scoring there keeps the runner clean.

## Decision

An eval spec may carry a top-level `evaluator` block with a `model` (required) and a `criteria` array. Each criterion has an `id`, a `statement` (the yes/no question the judge answers), and an optional `points` (default 1). The judge model is called once per completed variant during `collectEval`; its verdict is written to an `evaluation.json` sidecar alongside `metrics.json`.

The judge runs via `runners/judge.ts` using the `claude --print --output-format stream-json` path, identical to the agent runner but with no tool access. The prompt is composed by `core/evaluator.ts` from the rubric, a truncated git diff, and a formatted transcript. `core/transcript.ts` reconstructs variant conversations from the usage index and formats them as plain text for the judge.

If the judge call fails for any reason, the collection step records all criteria as failed with a warning, rather than aborting the run.

## Consequences

- Eval runs with an `evaluator` block produce an `evaluation.json` sidecar after collection. The Eval UI reads this sidecar and shows a score chip on each variant card and a per-criterion Scoring section.
- Eval runs without an `evaluator` block are unchanged: no judge is called, no sidecar is written, and the UI shows no score chip.
- The judge model incurs additional API cost at collection time. Operators who want to suppress scoring can remove the `evaluator` block from the spec.
- Binary scoring simplifies the judge prompt and makes verdicts easy to interpret, at the cost of not capturing "mostly right" cases.
- The judge model is explicitly named in the spec, so changing the judge model is a deliberate, version-controlled edit rather than a silent global default change.
