# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/hooks contains Claude/Codex hook event catalogs, config paths, config merge/remove, install/uninstall/status, shell quoting, and repo-local excludes.
- @tangent/agent-runtime contains process execution and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.

Vertical apps:
- @tangent/usage owns conversation telemetry schemas, native transcript normalization, hook normalization, native-log schema compatibility checks, assistant-centered conversation reports, datasets, SDK, and CLI.
- @tangent/rollup owns rollup note schemas, period-level rollup inputs, examples, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, and reports.
- @tangent/search owns structural indexing and search.

Root CLI:
- Owns human command taxonomy (`setup`, `status`, `usage`, `rollup`, `search`, `eval`, `doctor`) and may compose public SDKs.
- Must keep raw/debug/CI surfaces hidden from default help when they are not human product commands.

Hard rules:
- rollup and eval may depend on usage.
- usage must not depend on rollup, eval, or search.
- search must not depend on usage, rollup, or eval.
- hooks must not import Usage schemas.
- Native provider transcript formats are interpreted in usage, not hooks. Schema inference tools may live outside runtime packages, but runtime compatibility checks and user-facing version messages belong in usage.
- Rollup must consume Usage reports rather than parsing Claude or Codex provider schemas directly.
- agent-runtime must not import Rollup or Eval schemas.
- Cross-package imports must use public package exports.
