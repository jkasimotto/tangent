# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/agent-runtime contains process execution, the OS-agnostic desktop notifier, and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.
- @tangent/ui-server contains reusable local HTTP static serving, mounted app assets, and API route dispatch for product UIs.

UI platform packages:
- @tangent/ui-tokens contains framework-free semantic tokens and theme CSS.
- @tangent/ui-server contains framework-agnostic local HTTP static serving, optional Vite middleware for workspace dev, mounted app assets, and API route dispatch.
- @tangent/tangent-ui contains the Svelte combined-app shell and must not import product packages.
- Product UI packages such as @tangent/usage-ui and @tangent/eval-ui own embedded browser modules for the combined shell.

Vertical apps:
- @tangent/usage owns the full Usage app surface: compatibility SDK exports, standalone CLI, and local Usage UI server.
- @tangent/rollup owns rollup note schemas, period-level user-message rollup inputs, examples, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, reports, diffs, and the local read-only Eval UI server.
- @tangent/search owns structural indexing and search.

Split Usage packages:
- @tangent/usage-schema has no UI, SQLite, or provider parser dependencies.
- @tangent/usage-core has dependency-light schemas, query helpers, in-memory projections, dataset/report types, and client construction with no UI, SQLite, or built-in provider loading.
- @tangent/usage-index-sqlite owns repo/native data loading, optional SQLite projection/index behavior, status, archive, and compatibility SDK APIs.
- @tangent/usage-providers owns provider adapters/native transcript loading.
- @tangent/usage owns the standalone Usage CLI; the former usage-cli migration scaffold is removed.
- @tangent/usage remains the compatibility meta-package during migration.

Root CLI:
- Owns human command taxonomy (`setup`, `status`, `ui`, `usage`, `rollup`, `search`, `eval`, `doctor`) and may compose installed product commands and UI app descriptors through lazy imports.
- Must keep raw/debug/CI surfaces hidden from default help when they are not human product commands.

Install contract:
- This remains one git monorepo and one workspace for development.
- `@tangent/usage`, `@tangent/rollup`, `@tangent/search`, and `@tangent/eval` must be publishable and installable independently.
- Standalone app packages may depend on platform packages. Rollup and Eval may depend on dependency-light Usage data packages, but must not pull the full Usage app or Usage UI packages. Product UI bundles may be dependencies of their owning app package. No standalone app may pull an unrelated vertical app.
- The root `tangent ui` command may compose installed vertical UI descriptors. Standalone app CLIs keep their own UI entrypoints when provided.
- UI-capable product packages declare `tangent.uiApp` metadata in `package.json`; the root shell discovers manifests and imports only selected installed app factories.
- Publishable manifests must use semver `@tangent/*` dependencies, not `file:`, `link:`, or `workspace:` protocols.
- Standalone CLIs use `tangent-usage`, `tangent-search`, `tangent-rollup`, and `tangent-eval`; the root `tangent` package keeps short subcommands.

Hard rules:
- rollup and eval may depend on dependency-light Usage data packages, not the full Usage app or Usage UI packages.
- usage must not depend on rollup, eval, or search.
- search must not depend on usage, rollup, or eval.
- Hook install and hook record product surfaces are retired; do not add new provider hook config mechanics.
- Native provider transcript formats are interpreted in usage, not hooks. Schema inference tools may live outside runtime packages, but runtime compatibility checks and user-facing version messages belong in usage.
- Rollup must consume Usage data APIs rather than parsing Claude or Codex provider schemas directly.
- `@tangent/usage-core` must not load SQLite, pricing, server, UI, or built-in provider parser code.
- `@tangent/usage-schema` and `@tangent/usage-core` must not import UI, SQLite, or provider parser packages.
- UI platform packages must not import Usage, Eval, Rollup, or Search product packages.
- The root `tangent` package must not depend on product packages or statically import product source; products are optional peers or separate installs.
- agent-runtime must not import Rollup or Eval schemas.
- Cross-package imports must use public package exports.
