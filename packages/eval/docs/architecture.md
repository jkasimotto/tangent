# @tangent/eval Architecture

Prepare, run, collect, compare, report, and inspect coding-agent eval variants in a local UI.

Rules:
- Eval may consume Usage metrics.
- Keep Eval installable with Usage and platform packages, but without Search or Rollup.
- Keep eval specs, contexts, and manifests in Eval.
- The eval UI is local-only, served by `@tangent/eval`, and never uploads data.
- UI behavior: browse runs, launch a run from a project spec (background execution with polled status), select one case, compare two variants, show agent/model/context metadata, diff prompts, context files, and changed code files, and compare output metrics (time, peak context, files changed, activity sparkline).
- Launching from the UI composes `prepareEval`, `runPreparedEval`, and `collectEval`; it adds no new run mechanics and inherits parallel variant execution.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
