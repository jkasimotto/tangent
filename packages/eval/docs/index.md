# @tangent/eval Docs

Purpose: Prepare, run, collect, compare, and report coding-agent eval variants. CLI shortcuts include `eval quick` and `latest` run resolution for report/diff/open/collect. The local UI inspects prepared run artifacts and compares two variants in one case without running agents.

Read next:
- architecture.md
- public-api.md

Package rules:
- Eval may consume Usage metrics.
- Keep eval specs, contexts, and manifests in Eval.

## Context assembly

`context-assembly.ts` reconstructs the repo-contributed context a coding agent would see over a variant's frozen worktree. It reads through an injected `ContextSource` so it is pure and testable without git. Given a `cwd`, it produces:

- The CLAUDE.md chain (root to cwd, `CLAUDE.md` before `CLAUDE.local.md` per directory) with `@import` tokens expanded inline (max depth 4, relative to the importing file, skipped inside backticks and fenced code, cycle-guarded). Files below `cwd` are listed as lazy rather than concatenated.
- A skills index: one entry per discoverable `.claude/skills/<name>/SKILL.md` (frontmatter always included; full body included only when the skill is in the loaded set).
- A subagents index: metadata only for each `.claude/agents/<name>.md`.

Boundary: repo-contributed context only. The base system prompt, `~/.claude` user-global files, plugin skills, and managed policy are not included.

Two read-only GET endpoints expose this over the eval server: `GET /api/eval/runs/:runId/context/manifest` for the skill and subagent roster, and `GET /api/eval/runs/:runId/context/assemble` for the full assembled context at a given `cwd` and loaded-skill set.

## LLM judge scoring

An eval spec may carry a top-level `evaluator` block with a `model` string and a `criteria` array. Each criterion has an `id`, a `statement` (a yes/no question the judge answers), and an optional `points` (default 1). Scoring runs automatically during `collectEval` for every completed variant.

`core/evaluator.ts` composes the judge prompt from the rubric, a truncated git diff (up to 20,000 characters), and a formatted transcript (up to 12,000 characters). `core/transcript.ts` reconstructs the variant's conversations from the usage index and formats them as plain text that the judge can read. `runners/judge.ts` calls `claude --print --output-format stream-json` with the composed prompt and the specified judge model; it emits no telemetry and uses no tools.

The judge returns a JSON object with a `criteria` array of `{ id, passed, reasoning }` entries. Each criterion earns its full point allotment (binary scoring: full points or zero). The result is written to an `evaluation.json` sidecar alongside `metrics.json` in the variant's run directory. If the judge call fails, all criteria are recorded as failed with a warning rather than aborting the collection step.

The Eval UI reads `evaluation.json` and shows a score chip on each variant card and a per-criterion Scoring section with A/B verdicts.

## Marks

`marks/types.ts`, `marks/store.ts`, and `marks/resolve.ts` implement the mark loop's capture surface (see `docs/superpowers/specs/2026-07-05-mark-loop-design.md` and ADR-0015). A mark is a `tangent.mark.v1` record: a moment-anchored capture of an agent failure (`kind: "failure"`) or a mined efficiency exemplar (`kind: "candidate"`), stored as one JSON file per mark under `~/.tangent/marks/` (`marksHome()`, overridable via `TANGENT_MARKS_HOME`/`TANGENT_HOME`, and every store function takes the directory as an injectable last argument so tests never touch the real home directory).

`marks/resolve.ts` resolves the anchor: `resolveCurrentSessionAnchor(cwd)` finds the newest Claude transcript keyed to a cwd across every Claude profile, reusing `discoverClaudeNative` re-exported from `@tangent/usage-index-sqlite`; `resolveAnchorForSession(sessionId)` looks up an explicitly named session instead. The Usage index ordinal is left unset at capture time and resolves lazily on first view, so marking never blocks on the session already being indexed.

`tangent mark "<note>"` captures against the cwd-resolved current session; `tangent mark --json` reads a full or partial record from stdin (the `/mark` skill's entry point) and fills in id/at/status/anchor/repo defaults via `createMarkRecord`. `tangent mark list|show|update` support the triage-to-fix workflow. The command is wired as a top-level `tangent mark` root command, not nested under `tangent eval`.
