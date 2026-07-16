# Agent Notes

Purpose: Delegated-thread sweep, registry, and attach.

Local rules:
- Do not depend on Usage (full package), Rollup, or Eval. Only @tangent/usage-index-sqlite for session telemetry.
- State derivation (src/core/derive.ts) is pure and deterministic; a model never decides a thread's state, only describes it.
- The daemon writes only threads.md, the sidecar JSON, and notifications. It never edits vault notes, overviews, or thread files.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
