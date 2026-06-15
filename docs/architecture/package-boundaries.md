# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/agent-runtime contains process execution and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.

Vertical apps:
- @tangent/usage owns conversation telemetry schemas, native transcript normalization, legacy usage-jsonl reading, native-log schema compatibility checks, assistant-centered conversation reports, datasets, SDK, and CLI.
- @tangent/rollup owns rollup note schemas, period-level user-message rollup inputs, examples, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, reports, diffs, and the local eval comparison UI.
- @tangent/search owns structural indexing and search.

Root CLI:
- Owns human command taxonomy (`setup`, `status`, `usage`, `rollup`, `search`, `eval`, `doctor`) and may compose public SDKs.
- Must keep raw/debug/CI surfaces hidden from default help when they are not human product commands.

Install contract:
- This remains one git monorepo and one workspace for development.
- `@tangent/usage`, `@tangent/search`, `@tangent/rollup`, and `@tangent/eval` must be publishable and installable independently.
- Standalone app packages may depend on platform packages. Rollup and Eval may also depend on Usage. No standalone app may pull an unrelated vertical app.
- Publishable manifests must use semver `@tangent/*` dependencies, not `file:`, `link:`, or `workspace:` protocols.
- Standalone CLIs use `tangent-usage`, `tangent-search`, `tangent-rollup`, and `tangent-eval`; the root `tangent` package keeps short subcommands.

Hard rules:
- rollup and eval may depend on usage.
- usage must not depend on rollup, eval, or search.
- search must not depend on usage, rollup, or eval.
- Hook install and hook record product surfaces are retired; do not add new provider hook config mechanics.
- Native provider transcript formats are interpreted in usage, not hooks. Schema inference tools may live outside runtime packages, but runtime compatibility checks and user-facing version messages belong in usage.
- Rollup must consume Usage reports rather than parsing Claude or Codex provider schemas directly.
- agent-runtime must not import Rollup or Eval schemas.
- Cross-package imports must use public package exports.
