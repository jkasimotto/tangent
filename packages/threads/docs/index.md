# @tangent/threads Docs

Purpose: Delegated-thread sweep, registry, and attach. Externalizes Julian's parallel portfolio of
people, branches, and coding agents into the tangent vault, so `threads.md` and a JSON sidecar
carry the state instead of his working memory.

Read next:
- architecture.md
- public-api.md

Package rules:
- Do not depend on Usage (full package), Rollup, or Eval. Only @tangent/usage-index-sqlite for session telemetry.
- State derivation is pure and deterministic; a model never decides a thread's state, only describes it in prose (why-lines, check-in drafts).
- The daemon writes only `threads.md`, the sidecar JSON, and notifications. It never edits vault notes, overviews, or thread files.

Operational notes:
- `tangent threads sweep` is meant to run on a schedule (launchd, every 15 minutes during waking hours); it is safe to run repeatedly and idempotent when nothing has changed.
- `tangent threads sweep --dry-run` prints the would-be `threads.md` and would-be notifications without writing anything or notifying.
- A failed sweep (vault scan error) exits nonzero and leaves the previous `threads.md` and sidecar completely untouched; a haiku failure is not a sweep failure and falls back to templated why-lines.
- Design spec: `docs/superpowers/specs/2026-07-16-delegated-threads-orchestration-design.md` at the repo root is authoritative for behavior.
