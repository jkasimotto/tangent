# Package Boundaries

Platform packages:
- @tangent/core contains pure shared primitives. It must not shell out, write provider config, or know product domains.
- @tangent/repo contains repo discovery, git, worktree, filesystem path, and safe path helpers.
- @tangent/agent-runtime contains process execution and reusable agent runner primitives.
- @tangent/governance contains custom architecture/docs/lint checks.
- @tangent/ui-server contains reusable local HTTP static serving, mounted app assets, and API route dispatch for product UIs.

UI platform packages:
- @tangent/ui-tokens contains framework-free semantic tokens and theme CSS.
- @tangent/ui-server contains framework-agnostic local HTTP static serving, optional Vite middleware for workspace dev, mounted app assets, and API route dispatch.
- @tangent/tangent-ui contains the Svelte combined-app shell and must not import product packages.
- Product UI packages such as @tangent/usage-ui, @tangent/trees-ui, and @tangent/eval-ui own embedded browser modules for the combined shell.

Vertical apps:
- @tangent/usage owns conversation telemetry schemas, native transcript normalization, legacy usage-jsonl reading, native-log schema compatibility checks, canonical session/turn/step/message projections, dependency-light core/query APIs, optional SQLite indexing, assistant/session reports, datasets, SDK, CLI, and the local Usage UI server.
- @tangent/rollup owns rollup note schemas, period-level user-message rollup inputs, examples, rendering, ledgers, and summarization workflows.
- @tangent/eval owns eval specs, contexts, run manifests, metrics, reports, diffs, and the local read-only Eval UI server.
- @tangent/search owns structural indexing and search.
- Tangent Trees owns the `tangent trees` command center across split packages: schema, core, FS store, optional SQLite projection boundary, Git, terminal runtimes, agent adapters, attention, MCP, CLI, server, and UI.

Split Trees packages:
- @tangent/trees-schema has no Node-only runtime integrations, UI, SQLite, tmux, Git adapters, or old `pa` code.
- @tangent/trees-core has event APIs, projections, and lifecycle services with no React, SQLite, tmux implementation, iTerm, or old `pa` imports.
- @tangent/trees-store-fs owns the canonical V1 event log under `~/.tangent/trees`.
- @tangent/trees-store-sqlite is optional projection/index infrastructure and is not imported by core.
- @tangent/trees-git owns project/worktree behavior and may use `@tangent/repo`.
- @tangent/trees-terminal owns tmux/process runtime adapters.
- @tangent/trees-agents owns manual/custom/Codex/Claude/Gemini command adapters.
- @tangent/trees-attention owns status resolution and deterministic attention rules.
- @tangent/trees-mcp owns typed MCP tools.
- @tangent/trees-cli owns the CLI adapter and must not import React.
- @tangent/trees-ui owns the Trees browser bundle and must not import old `pa` code.
- @tangent/trees-server owns Trees local UI registration and server routes.

Split Usage packages:
- @tangent/usage-schema has no UI, SQLite, or provider parser dependencies.
- @tangent/usage-core has in-memory projections/query contracts and no UI or SQLite.
- @tangent/usage-index-sqlite owns optional SQLite projection/index behavior.
- @tangent/usage-providers owns provider adapters/native transcript loading.
- @tangent/usage-cli owns CLI-only composition.
- @tangent/usage remains the compatibility meta-package during migration.

Root CLI:
- Owns human command taxonomy (`setup`, `status`, `ui`, `usage`, `rollup`, `search`, `eval`, `doctor`) and may compose installed product commands and UI app descriptors through lazy imports.
- Must keep raw/debug/CI surfaces hidden from default help when they are not human product commands.

Install contract:
- This remains one git monorepo and one workspace for development.
- `@tangent/usage`, `@tangent/search`, `@tangent/rollup`, and `@tangent/eval` must be publishable and installable independently.
- Standalone app packages may depend on platform packages. Rollup and Eval may also depend on Usage. Product UI bundles may be dependencies of their owning app package. No standalone app may pull an unrelated vertical app.
- The root `tangent ui` command may compose installed vertical UI descriptors. Standalone app CLIs keep their own UI entrypoints when provided.
- UI-capable product packages declare `tangent.uiApp` metadata in `package.json`; the root shell discovers manifests and imports only selected installed app factories.
- Publishable manifests must use semver `@tangent/*` dependencies, not `file:`, `link:`, or `workspace:` protocols.
- Standalone CLIs use `tangent-usage`, `tangent-search`, `tangent-rollup`, and `tangent-eval`; the root `tangent` package keeps short subcommands.

Hard rules:
- rollup and eval may depend on usage.
- usage must not depend on rollup, eval, or search.
- search must not depend on usage, rollup, or eval.
- Hook install and hook record product surfaces are retired; do not add new provider hook config mechanics.
- Native provider transcript formats are interpreted in usage, not hooks. Schema inference tools may live outside runtime packages, but runtime compatibility checks and user-facing version messages belong in usage.
- Rollup must consume Usage reports rather than parsing Claude or Codex provider schemas directly.
- `@tangent/usage/schema`, `@tangent/usage/core`, and `@tangent/usage/query` must not load SQLite, pricing, server, or UI code. SQLite belongs behind `@tangent/usage/sqlite` and CLI/index compatibility paths. Usage UI serving belongs behind `@tangent/usage/server` and the `usage ui` CLI command.
- `@tangent/usage-schema` and `@tangent/usage-core` must not import UI, SQLite, or provider parser packages.
- UI platform packages must not import Usage, Eval, Rollup, or Search product packages.
- The root `tangent` package must not depend on product packages or statically import product source; products are optional peers or separate installs.
- agent-runtime must not import Rollup or Eval schemas.
- Cross-package imports must use public package exports.
- Trees package boundaries are enforced by `deps/trees-boundaries`.
