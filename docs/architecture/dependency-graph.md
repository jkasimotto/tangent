# Dependency Graph

```text
root CLI
  -> @tangent/usage
  -> @tangent/usage/cli
  -> @tangent/rollup
  -> @tangent/rollup/cli
  -> @tangent/search
  -> @tangent/eval/cli
  -> @tangent/search/cli
  -> @tangent/governance/cli

@tangent/rollup -> @tangent/usage, @tangent/core, @tangent/repo, @tangent/agent-runtime
@tangent/eval -> @tangent/usage, @tangent/core, @tangent/repo, @tangent/agent-runtime
@tangent/usage -> @tangent/core, @tangent/repo (optional: better-sqlite3 behind @tangent/usage/sqlite)
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
@tangent/usage-index-sqlite -> @tangent/usage-core, @tangent/usage-schema, optional better-sqlite3
@tangent/usage-providers -> @tangent/usage-schema
@tangent/usage-cli -> @tangent/usage-core, @tangent/usage-index-sqlite, @tangent/usage-providers

@tangent/ui-tokens -> none
@tangent/ui-primitives -> @tangent/ui-tokens
@tangent/ui-components -> @tangent/ui-primitives
@tangent/ui-patterns -> @tangent/ui-components, @tangent/ui-primitives
@tangent/ui-charts -> @tangent/ui-components, @tangent/ui-primitives
@tangent/ui-code -> @tangent/ui-components, @tangent/ui-primitives
@tangent/ui-app-shell -> @tangent/ui-patterns, @tangent/ui-components, @tangent/ui-primitives
@tangent/ui-server -> @tangent/core

@tangent/usage-ui-data -> no React
@tangent/eval-ui-data -> no React
@tangent/rollup-ui-data -> no React
@tangent/usage-ui -> @tangent/usage-ui-data, ui-* packages
@tangent/eval-ui -> @tangent/eval-ui-data, ui-* packages
@tangent/rollup-ui -> @tangent/rollup-ui-data, @tangent/usage-ui, ui-* packages
```

The graph is enforced by @tangent/governance. If a package dependency changes, update this file and the lint allowlist in the same change. Usage subpaths `/schema`, `/core`, and `/query` are dependency-light entrypoints and must not load optional SQLite.

Package manifests must keep this graph publishable: use normal semver ranges for `@tangent/*` dependencies, not local workspace protocols. Installing one vertical app should install only that app plus its declared platform dependencies, except Rollup/Eval may also install Usage.
