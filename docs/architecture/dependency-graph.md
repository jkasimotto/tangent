# Dependency Graph

```text
root CLI
  -> @tangent/core
  -> @tangent/tangent-ui
  -> @tangent/ui-server

root CLI lazy optional products
  -> @tangent/usage/cli
  -> @tangent/usage/server
  -> @tangent/trees-cli/cli
  -> @tangent/trees-server
  -> @tangent/rollup/cli
  -> @tangent/search/cli
  -> @tangent/eval/cli
  -> @tangent/eval/server
  -> @tangent/governance/cli

@tangent/rollup -> @tangent/usage, @tangent/core, @tangent/repo, @tangent/agent-runtime
@tangent/eval -> @tangent/usage, @tangent/core, @tangent/repo, @tangent/agent-runtime, @tangent/ui-server, @tangent/eval-ui
@tangent/usage -> @tangent/core, @tangent/repo, @tangent/ui-server, @tangent/usage-ui, @tangent/usage-ui-data (optional: better-sqlite3 behind @tangent/usage/sqlite)
@tangent/search -> @tangent/core, @tangent/repo
@tangent/trees-cli -> @tangent/core, @tangent/trees-schema, @tangent/trees-core, @tangent/trees-store-fs, @tangent/trees-git, @tangent/trees-terminal, @tangent/trees-agents, @tangent/trees-attention, @tangent/trees-mcp
@tangent/trees-server -> @tangent/ui-server, @tangent/trees-ui, @tangent/trees-schema, @tangent/trees-store-fs
@tangent/trees-ui -> @tangent/ui-tokens
@tangent/repo -> @tangent/core
@tangent/agent-runtime -> @tangent/core
@tangent/governance -> @tangent/core
@tangent/core -> none
```

UI graph:

```text
@tangent/usage-schema -> none
@tangent/usage-core -> @tangent/usage-schema, @tangent/core, @tangent/repo
@tangent/usage-index-sqlite -> @tangent/usage-core, @tangent/usage-schema, optional better-sqlite3
@tangent/usage-providers -> @tangent/usage-schema
@tangent/usage-cli -> @tangent/usage-core, @tangent/usage-index-sqlite, @tangent/usage-providers

@tangent/ui-tokens -> none
@tangent/ui-server -> @tangent/core
@tangent/tangent-ui -> @tangent/ui-tokens

@tangent/usage-ui-data -> no React
@tangent/usage-ui -> @tangent/usage-ui-data, @tangent/ui-tokens, Svelte
@tangent/eval-ui -> @tangent/ui-tokens, Svelte
```

Trees graph:

```text
@tangent/trees-schema -> none
@tangent/trees-core -> @tangent/trees-schema
@tangent/trees-store-fs -> @tangent/trees-core, @tangent/trees-schema
@tangent/trees-store-sqlite -> @tangent/trees-core, @tangent/trees-schema
@tangent/trees-git -> @tangent/trees-core, @tangent/trees-schema, @tangent/repo
@tangent/trees-terminal -> @tangent/trees-core, @tangent/trees-schema, @tangent/core, @tangent/agent-runtime
@tangent/trees-agents -> @tangent/trees-core, @tangent/trees-schema
@tangent/trees-attention -> @tangent/trees-schema
@tangent/trees-mcp -> @tangent/trees-core, @tangent/trees-schema
@tangent/trees-ui -> @tangent/ui-tokens
@tangent/trees-server -> @tangent/ui-server, @tangent/trees-ui, @tangent/trees-schema, @tangent/trees-store-fs
```

The graph is enforced by @tangent/governance. If a package dependency changes, update this file and the lint allowlist in the same change. Usage subpaths `/schema`, `/core`, and `/query` are dependency-light entrypoints and must not load optional SQLite, server, or UI code. The Usage package-level UI dependencies are for `tangent usage ui` and the `@tangent/usage/server` subpath.

Package manifests must keep this graph publishable: use normal semver ranges for `@tangent/*` dependencies, not local workspace protocols. Installing one vertical app should install only that app plus its declared platform dependencies, except Rollup/Eval may also install Usage. The root `tangent` package is a thin shell and must not install product packages through `dependencies`; first-party products are optional peers or separately installed packages.
