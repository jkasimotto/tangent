# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/agent-runtime contains process execution and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.
- @tangent/ui-server contains reusable local HTTP static serving and API route dispatch for product UIs.

UI platform packages:
- @tangent/ui-tokens contains framework-free semantic tokens and theme CSS.
- @tangent/ui-primitives contains accessible low-level React controls.
- @tangent/ui-components contains generic Tangent product components, not product domain mappers.
- @tangent/ui-patterns contains reusable page/workflow layouts.
- @tangent/ui-charts contains visualizations with table fallbacks and copy/export actions.
- @tangent/ui-code contains shared code, diff, markdown, JSON, and transcript renderers.
- @tangent/ui-app-shell contains the global shell, navigation, search, command palette, and server status UI.

Vertical apps:
- @tangent/usage owns conversation telemetry schemas, native transcript normalization, legacy usage-jsonl reading, native-log schema compatibility checks, canonical session/turn/step/message projections, dependency-light core/query APIs, optional SQLite indexing, assistant/session reports, datasets, SDK, and CLI.
- @tangent/rollup owns rollup note schemas, period-level user-message rollup inputs, examples, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, reports, diffs, and the local eval comparison UI.
- @tangent/search owns structural indexing and search.

Split Usage packages:
- @tangent/usage-schema has no UI, SQLite, or provider parser dependencies.
- @tangent/usage-core has in-memory projections/query contracts and no UI or SQLite.
- @tangent/usage-index-sqlite owns optional SQLite projection/index behavior.
- @tangent/usage-providers owns provider adapters/native transcript loading.
- @tangent/usage-cli owns CLI-only composition.
- @tangent/usage remains the compatibility meta-package during migration.

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
- `@tangent/usage/schema`, `@tangent/usage/core`, and `@tangent/usage/query` must not load SQLite, pricing, server, or UI code. SQLite belongs behind `@tangent/usage/sqlite` and CLI/index compatibility paths.
- `@tangent/usage-schema` and `@tangent/usage-core` must not import UI, SQLite, or provider parser packages.
- `ui-*` packages must not import Usage, Eval, Rollup, or Search product packages, except `ui-docs` may import product UI packages for examples.
- agent-runtime must not import Rollup or Eval schemas.
- Cross-package imports must use public package exports.
