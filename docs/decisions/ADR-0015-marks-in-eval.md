# ADR-0015 Marks Live in @tangent/eval

Date: 2026-07-06

## Context

The mark loop (`docs/superpowers/specs/2026-07-05-mark-loop-design.md`) needs a place to capture a
`tangent.mark.v1` record the moment a user judges an agent's behavior, or mines a telemetry
exemplar. Phase 1 adds the marks module (types, store, session resolution) and a `tangent mark` CLI.
Three placements were considered:

- **A new `@tangent/marks` package.** Owns its own workspace entry, governance dependency-graph row,
  and `docs/index.md`/`docs/architecture.md`/`docs/public-api.md` triple, for a module that is a few
  hundred lines and has exactly one consumer today (the eval machinery a mark is promoted into).
- **Inside `@tangent/usage`.** Usage owns conversation telemetry and transcript discovery, which
  marks read from. But marks exist specifically to become eval cases, and the package-boundary rule
  is that Usage must never depend upward on Eval or Rollup (`docs/architecture/package-boundaries.md`).
  Placing marks in Usage would either violate that rule once marks grow a `to-eval` scaffolder, or
  force an awkward split where the record lives in Usage and the promotion logic lives in Eval.
- **Inside `@tangent/eval`.** Eval already depends on `@tangent/usage-index-sqlite` for metrics and
  transcript reconstruction, so reusing Claude session discovery is a same-direction dependency, not
  a new edge. Marks becoming eval cases is the entire point of the mark loop.

## Decision

Marks live in `@tangent/eval` (`packages/eval/src/marks/`): the record type, a per-file JSON store
under `~/.tangent/marks/`, and Claude session resolution reused from
`@tangent/usage-index-sqlite`'s re-exported `claudeHomes`/`discoverClaudeNative`. The `tangent mark`
CLI is implemented in `@tangent/eval/cli` and exported as `runMarkCli`, but wired as a top-level root
command (`tangent mark ...`), not nested under `tangent eval`, because marking a failure is a
different, much more frequent action than running an eval and should not require typing the longer
path every time.

`@tangent/usage-index-sqlite`'s public `sdk` export now re-exports `claudeHome`, `claudeHomes`,
`claudeProjectKey`, and `discoverClaudeNative` (previously only reachable through
`@tangent/usage-providers` deep import paths), so `@tangent/eval` can resolve a cwd to its newest
Claude transcript without adding `@tangent/usage-providers` to its own allowed dependency set.

## Consequences

- No new package, workspace entry, or governance dependency-graph row for marks in phase 1.
- Marks inherit Eval's existing publish/install contract (`@tangent/eval` is independently
  installable, and marks ship with it).
- If marks grow independent consumers beyond eval (e.g. a standalone marks-only tool), extraction
  into `@tangent/marks` is mechanical: the module is already self-contained under `src/marks/` with
  no imports from the rest of Eval's source.
- `@tangent/usage-index-sqlite`'s public surface grew by one re-export line; no new behavior, no new
  dependency edge for its consumers.

Related: the marks inbox (phase 2) links out to the conversation in the Usage app by URL, never by
package import, keeping Usage's UI free of any Eval import; that rule is recorded alongside this one
per the design doc's build plan for when phase 1 lands.
