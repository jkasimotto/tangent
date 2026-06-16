# @tangent/eval Architecture

Prepare, run, collect, compare, report, and inspect coding-agent eval variants in a local UI.

Rules:
- Eval may consume Usage metrics.
- Keep Eval installable with Usage and platform packages, but without Search or Rollup.
- Keep eval specs, contexts, and manifests in Eval.
- The eval UI is local-only, served by `@tangent/eval`, and reads existing prepared run artifacts without uploading data.
- V1 UI behavior is read-only: browse runs, select one case, compare two variants, show agent/model/context metadata, and diff prompts plus context files.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
