# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/hooks contains Claude/Codex hook event catalogs, config paths, config merge/remove, install/uninstall/status, shell quoting, and repo-local excludes.
- @tangent/agent-runtime contains process execution and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.

Vertical apps:
- @convos/convos owns conversation telemetry schemas, hook normalization, datasets, SDK, and CLI.
- @tangent/daily owns daily note schemas, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, and reports.
- @tangent/search owns structural indexing and search.

Hard rules:
- daily and eval may depend on convos.
- convos must not depend on daily, eval, or search.
- search must not depend on convos, daily, or eval.
- hooks must not import Convos schemas.
- agent-runtime must not import Daily or Eval schemas.
- Cross-package imports must use public package exports.
