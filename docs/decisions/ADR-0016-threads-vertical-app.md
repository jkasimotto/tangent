# ADR-0016 Threads Vertical App

Date: 2026-07-16

## Decision

`@tangent/threads` is introduced as a new vertical app, allowed to depend on dependency-light Usage data packages the same way Rollup and Eval already do (ADR-0008 precedent). The vertical-dependency rule amends from "rollup/eval -> usage" to "rollup/eval/threads -> usage", enforced by the governance dependency-graph lint.

`@tangent/threads` provides `tangent threads sweep|list|register|attach`, a daemon that derives delegated-thread state from the `~/.tangent/trees` vault (thread files, overview items) and live agent session state read through `@tangent/usage-index-sqlite`, per `docs/superpowers/specs/2026-07-16-delegated-threads-orchestration-design.md`. Its allowed dependencies are exactly `@tangent/core`, `@tangent/repo`, `@tangent/agent-runtime`, and `@tangent/usage-index-sqlite`, mirroring `@tangent/rollup`.

Threads reaches the vault by path convention only, the same way the `/tangent` skill does, never as a code dependency, so the vault stays a plain markdown vault with no code coupling. Threads never imports Eval or Rollup.

## Consequences

- Governance's `allowedPackageDeps` and the `deps/no-vertical-backedges` fix message both list threads alongside rollup and eval.
- ARCHITECTURE.md, `docs/architecture/package-boundaries.md`, and `docs/architecture/dependency-graph.md` list `@tangent/threads` as a vertical app and record its dependency edges.
- `@tangent/threads` must be publishable and installable independently, like Rollup, Eval, and Search.
- Threads must not pull the full Usage app or Usage UI packages, and Usage must not learn about Threads.
