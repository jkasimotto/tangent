# Dependency Graph

```text
root CLI
  -> @tangent/core
  -> @tangent/tangent-ui
  -> @tangent/ui-server

root CLI lazy optional products
  -> @tangent/usage/cli
  -> @tangent/usage/server
  -> @tangent/rollup/cli
  -> @tangent/search/cli
  -> @tangent/eval/cli
  -> @tangent/eval/server
  -> @tangent/governance/cli

@tangent/rollup -> @tangent/usage-index-sqlite, @tangent/core, @tangent/repo, @tangent/agent-runtime
@tangent/eval -> @tangent/usage-index-sqlite, @tangent/core, @tangent/repo, @tangent/agent-runtime, @tangent/ui-server, @tangent/eval-ui
@tangent/usage -> @tangent/core, @tangent/repo, @tangent/ui-server, @tangent/usage-core, @tangent/usage-index-sqlite, @tangent/usage-providers, @tangent/usage-ui, @tangent/usage-ui-data
@tangent/search -> @tangent/core, @tangent/repo
@tangent/repo -> @tangent/core
@tangent/agent-runtime -> @tangent/core
@tangent/governance -> @tangent/core
@tangent/core -> none
```

UI graph:

```text
@tangent/usage-schema -> none
@tangent/usage-core -> @tangent/usage-schema, @tangent/core, @tangent/repo
@tangent/usage-index-sqlite -> @tangent/usage-core, @tangent/usage-schema, @tangent/usage-providers, @tangent/repo, optional better-sqlite3
@tangent/usage-providers -> @tangent/usage-core, @tangent/usage-schema, @tangent/repo
@tangent/ui-tokens -> none
@tangent/ui-server -> @tangent/core
@tangent/tangent-ui -> @tangent/ui-tokens

@tangent/usage-ui-data -> no React
@tangent/usage-ui -> @tangent/usage-ui-data, @tangent/ui-tokens, Svelte
@tangent/eval-ui -> @tangent/ui-tokens, Svelte
```

The graph is enforced by @tangent/governance. If a package dependency changes, update this file and the lint allowlist in the same change. Usage subpaths `/schema`, `/core`, and `/query` are dependency-light entrypoints and must not load optional SQLite, server, or UI code. The Usage package-level UI dependencies are for `tangent usage ui` and the `@tangent/usage/server` subpath.

Package manifests must keep this graph publishable: use normal semver ranges for `@tangent/*` dependencies, not local workspace protocols. Installing one vertical app should install only that app plus its declared platform dependencies. Rollup/Eval may install dependency-light Usage data packages, but must not install the full Usage app or Usage UI packages just to read telemetry. The root `tangent` package is a thin shell and must not install product packages through `dependencies`; first-party products are optional peers or separately installed packages.
