# Tangent Architecture

Tangent is a monorepo for local coding-agent applications. The root CLI owns the human command taxonomy and composes vertical apps plus public SDKs for product-level setup/status.

Read next:
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/architecture/layering.md
- docs/architecture/hooks.md
- docs/architecture/agent-runtime.md

Core rule: vertical apps stay independent. Shared infrastructure lives in platform packages, not in Usage and not copied app-to-app.

Install rule: Tangent stays in one git monorepo, but each vertical app package must be publishable and usable on its own. Standalone installs may depend on platform packages and, for Rollup/Eval, Usage, but must not pull unrelated vertical apps. Package manifests use normal semver `@tangent/*` dependency ranges; workspace-local `file:`, `link:`, and `workspace:` dependency specs are not allowed in publishable manifests.

Allowed dependency shape:

```text
root CLI
  -> usage SDK/CLI/server | trees CLI/server | tangent-ui | ui-server | rollup SDK/CLI | eval CLI | search SDK/CLI | governance CLI

trees -> schema, core, fs store, git, terminal, agents, attention, MCP, server, ui

rollup -> usage, core, repo, agent-runtime
eval  -> usage, core, repo, agent-runtime
usage -> core, repo, ui-server, usage-ui, usage-ui-data
search -> core, repo
repo -> core
agent-runtime -> core
governance -> core, repo
core -> no Tangent package dependencies
```

UI platform packages are layered separately from product kernels:

```text
ui-tokens -> none
ui-server -> core
tangent-ui -> ui-tokens
ui-primitives -> ui-tokens
ui-components -> ui-primitives
ui-patterns -> ui-components, ui-primitives
ui-charts -> ui-components, ui-primitives
ui-code -> ui-components, ui-primitives
ui-app-shell -> ui-patterns, ui-components, ui-primitives
product-ui -> product-ui-data, ui-* packages
product-server -> product-core/API routes, product-ui assets, ui-server
```

Human-facing root commands are `setup`, `status`, `ui`, `usage`, `trees`, `rollup`, `search`, `eval`, `doctor`, and `completion`. Raw/debug/CI commands such as `governance`, `data export`, and `data archive` remain callable but hidden from default help.

Standalone package CLIs use collision-resistant binary names: `tangent-usage`, `tangent-search`, `tangent-rollup`, and `tangent-eval`. The root `tangent` CLI keeps the short subcommands for full-suite installs.

Usage owns conversation telemetry: event schemas, dependency-light core/query APIs, datasets, SDKs, CLI, native transcript normalization, native-log schema compatibility checks, legacy usage-jsonl reading, v3 event-to-session/turn/step/message projections, and assistant/session reports. It also owns the local `tangent usage ui` server, which lazily serves `@tangent/usage-ui` assets and framework-agnostic `/api/usage/*` routes over public Usage core APIs. Native provider transcripts are the source of truth for new data. Hook installation and hook recording are retired product surfaces; legacy `capture.source: "hook"` events remain readable through usage-jsonl compatibility. `@tangent/usage/schema`, `/core`, and `/query` must not load SQLite, pricing, server, or UI code; `@tangent/usage/sqlite` is the optional index layer. Rollup and Eval may consume Usage data, but Usage must not learn about Rollup, Eval, or Search.

Rollup consumes selected Usage turns and visible user messages under the configured length limit, then owns the summarization workflow: `tangent rollup <selector>` caches one period-level `rollup.input.v1` artifact, includes style examples from explicit examples and prior notes, runs one summary provider roll-up, and writes the generated note block. Assistant messages, tool calls, tool results, token metadata, and oversized pasted user messages are intentionally excluded from rollup input. Selectors support single days and compact inclusive ranges. Rollup does not parse Claude or Codex native schemas and does not preserve a topic or turn-digest architecture.

Eval owns local coding-agent evals: specs, contexts, run manifests, agent runs, metrics, reports, and diffs. Eval may read Usage metrics and git artifacts, but it does not upload eval or usage data. The old browser eval comparison UI is retired for now.

Trees owns Tangent Center: semantic work trees, optional Git worktrees, durable terminal runtimes, agent runs, typed work sessions, captures, observations, generated attention, a text command-center summary, and typed MCP tools. The old `pa` repo is only a behavioral reference and migration source; Trees uses event-sourced TypeScript packages and must not preserve `pa` sidecar status or storage models.

Tangent UI is the Svelte `@tangent/tangent-ui` shell plus product-owned embedded UI bundles. The root `tangent ui` command dynamically registers installed product app descriptors, serves the shell, exposes `/api/ui/apps`, and mounts product assets under `/apps/<app>/`. `@tangent/usage-ui` remains the standalone Usage app and also exposes an embedded bundle for the combined shell. `@tangent/trees-ui` starts as a minimal browser surface registered by `@tangent/trees-server`. API-only Usage consumers can install `@tangent/usage-schema` and `@tangent/usage-core` without Svelte, Vite, browser assets, or SQLite. Local product servers use `@tangent/ui-server` to serve compiled assets and register framework-agnostic JSON API routes.
