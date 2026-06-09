# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/hooks contains Claude/Codex hook event catalogs, config paths, config merge/remove, install/uninstall/status, shell quoting, and repo-local excludes.
- @tangent/agent-runtime contains process execution and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.

Vertical apps:
- @tangent/usage owns conversation telemetry schemas, native transcript normalization, hook normalization, native-log schema compatibility checks, assistant-centered conversation reports, datasets, SDK, and CLI.
- @tangent/daily owns daily note schemas, date-level rollup inputs, examples, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, and reports.
- @tangent/search owns structural indexing and search.

Root CLI:
- Owns human command taxonomy (`setup`, `status`, `usage`, `daily`, `search`, `eval`, `doctor`) and may compose public SDKs.
- Must keep raw/debug/CI surfaces hidden from default help when they are not human product commands.

Hard rules:
- daily and eval may depend on usage.
- usage must not depend on daily, eval, or search.
- search must not depend on usage, daily, or eval.
- hooks must not import Usage schemas.
- Native provider transcript formats are interpreted in usage, not hooks. Schema inference tools may live outside runtime packages, but runtime compatibility checks and user-facing version messages belong in usage.
- Daily must consume Usage reports rather than parsing Claude or Codex provider schemas directly.
- agent-runtime must not import Daily or Eval schemas.
- Cross-package imports must use public package exports.
