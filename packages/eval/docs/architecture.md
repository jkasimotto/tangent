# @tangent/eval Architecture

Prepare, run, collect, compare, report, and inspect coding-agent eval variants in a local UI.

Rules:
- Eval may consume Usage metrics.
- Keep Eval installable with Usage and platform packages, but without Search or Rollup.
- Keep eval specs, contexts, and manifests in Eval.
- The eval UI is local-only, served by `@tangent/eval`, and never uploads data.
- UI behavior: browse runs, launch a run from a project spec (background execution with polled status), select one case, compare two variants, show agent/model/context metadata, diff prompts, context files, and changed code files, and compare output metrics (time, peak context, files changed, activity sparkline).
- Launching from the UI composes `prepareEval`, `runPreparedEval`, and `collectEval`; it adds no new run mechanics and inherits parallel variant execution.

## Context assembly

`core/context-assembly.ts` is a pure engine that reconstructs the repo-contributed agent context over a variant's frozen worktree. It reads through an injected `ContextSource` (testable without git): walks the CLAUDE.md chain (root to cwd, `CLAUDE.md` before `CLAUDE.local.md`), expands `@import` tokens inline up to depth 4 (cycle-guarded, skips fenced code and backticks), lists CLAUDE.md files below cwd as lazy, discovers `.claude/skills/` and `.claude/agents/` frontmatter, and includes skill bodies only for the caller-supplied loaded set.

The server wires this to two read-only GET routes:
- `GET /api/eval/runs/:runId/context/manifest?caseId=&variant=` returns `{ skills, subagents }` (frontmatter only).
- `GET /api/eval/runs/:runId/context/assemble?caseId=&variant=&cwd=&skills=a,b` returns an `AssembledContext` with ordered blocks, skill and subagent lists, and the lazy-CLAUDE.md roster.

Each route constructs a `ContextSource` over the variant's frozen worktree at its context commit, so the assembled result is always the state the agent saw, not the current checkout.

Scope boundary: repo-contributed context only. Base system prompt, `~/.claude` user-global files, plugin skills, and managed policy are excluded by design.

## LLM judge scoring

`core/evaluator.ts` is the judge orchestrator. `evaluateVariant` reads the variant's `metrics.json` to get conversation IDs, calls `reconstructVariantConversations` from `core/transcript.ts` to build a list of `NormalizedConversation` objects from the usage index, and calls `gitText` to get the variant's diff. It then calls `composeJudgePrompt` to assemble the rubric, diff, and transcript into a single instruction prompt. The judge is invoked via `runners/judge.ts` and the raw text response is parsed by `core/verdict.ts` into a scored `EvalEvaluation`.

`core/transcript.ts` provides two utilities used by both the judge formatter and the conversation view: `relativeToWorktree` and `stripWorktree` rewrite worktree-absolute paths to short relative forms; `reconstructVariantConversations` iterates over conversation IDs and calls `loadUsageDatasetFromIndex` for each; `formatTranscriptForJudge` renders a list of `NormalizedConversation` objects as compact plain text capped at 12,000 characters.

`runners/judge.ts` wraps a single `claude --print --output-format stream-json --verbose --model <model>` process call. Prompt is passed via stdin. The runner emits no telemetry, loads no tools, and exists solely to call a distinct model from the agent under test. Failures propagate as thrown errors so `evaluateVariant` can catch them and record a failed evaluation with a warning.

The `evaluation.json` sidecar (schema `eval.evaluation.v1`) sits beside `metrics.json` in each variant's run directory. It records the judge model, the evaluation timestamp, each criterion's `passed` verdict and `reasoning`, and aggregate `totalPoints`/`maxPoints`. The Eval UI reads this sidecar to render score chips and the per-criterion Scoring section.

## Marks

`marks/types.ts` defines the `tangent.mark.v1` record and its validators (`assertMarkRecord` and friends). `marks/store.ts` persists one JSON file per mark under `marksHome()` (`~/.tangent/marks/` by default, `TANGENT_MARKS_HOME`/`TANGENT_HOME` overridable, and every function takes the directory as an injectable trailing argument): `writeMark`, `readMark`, `listMarks` (status/kind/repo filters, newest-first), `updateMark` (partial patch), and `createMarkRecord`/`createMarkId` (fills id/at/status/links defaults and derives `<yyyymmddThhmmss>-<slug>` ids from the observed text).

`marks/resolve.ts` resolves a mark's anchor without reimplementing transcript discovery: `resolveCurrentSessionAnchor(cwd)` and `resolveAnchorForSession(sessionId)` both call `discoverClaudeNative`, re-exported from `@tangent/usage-index-sqlite` (backed by `@tangent/usage-providers`, which already handles nested-cwd project-dir discovery and unions every `~/.claude*` profile). The resolved anchor's `ordinal` is left unset; the Usage index fills it lazily on first view rather than making capture depend on the session already being indexed.

`cli/commands/mark.ts` is the CLI surface: bare-note capture, `--json` stdin capture (validating and defaulting a full or partial record), and `list`/`show`/`update`. `cli/index.ts` exports `runMarkCli` separately from `runEvalCli` so the root CLI can wire `tangent mark` as a top-level command while the implementation stays in this package. See ADR-0015 for why marks live in Eval rather than a new package or in Usage.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
