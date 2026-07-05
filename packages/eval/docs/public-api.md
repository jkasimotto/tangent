# @tangent/eval Public API

Public import paths:
- @tangent/eval
- @tangent/eval/cli
- @tangent/eval/server

CLI notes:
- `tangent eval ...` is the root full-suite command.
- `tangent-eval ...` is the standalone package binary and accepts the same arguments without the root `eval` subcommand.
- `eval quick` is a shortcut alias for `eval run` with `--prompt`/`--context` flags.
- `eval collect|report|diff|open latest ...` resolves `latest` to the newest run manifest.
- `eval run` runs non-manual variants in parallel by default, prints prepare/run/collect progress in human mode, and keeps `--json` machine-readable.
- `eval context capture --include-ancestors` includes repo-local ancestor context files from `--cwd` up to the repo root, never files above the repo.
- `eval ui [run|latest]` starts the local Eval UI for browsing, launching, and comparing runs.
- `createEvalUiApp(...)` registers Eval for the combined `tangent ui` shell with `/api/eval/*` routes and embedded assets mounted under `/apps/eval/`.
- Eval specs support `prompt` on a variant; variant prompts override the case prompt, and existing case-level prompt specs remain valid.
- `runMarkCli(argv)` (also exported from `@tangent/eval/cli`) dispatches `tangent mark ...`, the mark loop's capture CLI. `tangent mark "<note>"` captures against the cwd-resolved current Claude session (`--session`/`--turn` override the anchor, `--observed`/`--expected`/`--hypothesis`/`--kind`/`--repo` fill the record). `tangent mark --json` reads a full or partial `tangent.mark.v1` record from stdin, the `/mark` skill's entry point. `tangent mark list [--status] [--kind] [--repo]`, `tangent mark show <id>`, and `tangent mark update <id> [--status] [--link-eval] [--link-fix]` support triage. The root CLI wires this as a top-level `tangent mark ...` command, not nested under `tangent eval`.

`/api/eval/*` routes:
- `GET /api/eval/selection` resolves the preferred or latest run id.
- `GET /api/eval/runs` lists run summaries; `GET /api/eval/runs/<id>` returns run detail with per-variant output metrics (time, peak context, files changed, and an activity sparkline). Each variant also carries an optional `evaluation` block (`{ model, totalPoints, maxPoints, criteria, warnings }`) when `evaluation.json` is present in the variant dir; this file is written by `collectEval` when the spec defines an `evaluator`.
- `GET /api/eval/runs/<id>/compare` compares two variants; artifacts cover prompts, context files, and changed code files (A's final file versus B's final file).
- `GET /api/eval/runs/<id>/diff` returns the line diff for one artifact (`kind` is `prompt`, `context`, or `code`).
- `GET /api/eval/specs` lists launchable specs from the project `evals/` directory and prior runs.
- `POST /api/eval/runs` with `{ specPath }` prepares a run, starts execution in the background, and returns `{ runId }`; the manifest is persisted per phase so polling `GET /api/eval/runs/<id>` shows live status.
- `GET /api/eval/runs/<id>/context/manifest?caseId=<id>&variant=<id>` returns `{ skills, subagents }`: the discoverable skill and subagent roster for the variant's frozen worktree (frontmatter only, `loaded` is always `false`).
- `GET /api/eval/runs/<id>/context/assemble?caseId=<id>&variant=<id>&cwd=<path>&skills=<a,b>` returns an `AssembledContext`: ordered blocks (CLAUDE.md chain with `@imports` expanded, skills index, requested skill bodies, subagents index), skill and subagent lists, and the lazy-CLAUDE.md roster. `cwd` is repo-relative; `skills` is a comma-separated list of skill names to load.
- `GET /api/eval/runs/<id>/conversations?caseId=<id>&variant=<id>` returns a `VariantConversationsView`: the variant's agent conversations reconstructed from the usage index (each turn's prose, hidden thinking, and tool calls with target paths and status), plus `notes` for caveats and any conversation that could not be reconstructed. Conversation ids come from the variant's `metrics.json`, so an uncollected variant returns no conversations and a note.

Context assembly exports (from `@tangent/eval`):
- `assembleContext(source, cwd, loadedSkills)` assembles the full repo-contributed context for a `cwd` and loaded-skill set.
- `contextManifest(source)` returns discoverable skills and subagents (frontmatter only).
- `parseFrontmatter(text)` extracts `name` and `description` from a leading YAML front-matter block.
- `claudeMdChain(allPaths, cwd)` returns `{ chain, lazy }`: the eager CLAUDE.md chain and the below-cwd lazy list.
- `discoverSkills(allPaths)`, `discoverSubagents(allPaths)` return sorted paths matching `.claude/skills/*/SKILL.md` and `.claude/agents/*.md`.
- Types: `AssembledContext`, `AssembledBlock`, `AssembledBlockKind`, `SkillEntry`, `SubagentEntry`, `ContextManifest`, `ContextSource`.

Agents must import through these public exports, not package src internals.
