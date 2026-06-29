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
