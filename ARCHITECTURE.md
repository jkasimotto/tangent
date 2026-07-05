# Tangent Architecture

Tangent is a monorepo for local coding-agent applications. The root CLI owns the human command taxonomy and composes installed vertical apps through lazy command imports and UI descriptors.

Read next:
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/architecture/layering.md
- docs/architecture/hooks.md
- docs/architecture/agent-runtime.md

Core rule: vertical apps stay independent. Shared infrastructure lives in platform packages, not in Usage and not copied app-to-app.

Install rule: Tangent stays in one git monorepo, but each vertical app package must be publishable and usable on its own. Standalone installs may depend on platform packages and, for Rollup/Eval, dependency-light Usage data packages, but must not pull unrelated vertical apps or Usage UI packages. Package manifests use normal semver `@tangent/*` dependency ranges; workspace-local `file:`, `link:`, and `workspace:` dependency specs are not allowed in publishable manifests.

Allowed dependency shape:

```text
root CLI
  -> core | tangent-ui | ui-server

installed app packages
  -> usage SDK/CLI/server | rollup SDK/CLI | eval CLI/server | mark CLI (in eval) | governance CLI

rollup -> usage-index-sqlite, core, repo, agent-runtime
eval  -> usage-index-sqlite, core, repo, agent-runtime, ui-server, eval-ui
usage -> usage-core, usage-index-sqlite, usage-providers, core, repo, ui-server, usage-ui, usage-ui-data
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

Human-facing root commands are `setup`, `status`, `ui`, `usage`, `rollup`, `eval`, `mark`, `doctor`, and `completion`. Raw/debug/CI commands such as `governance`, `data export`, and `data archive` remain callable but hidden from default help.

Standalone package CLIs use collision-resistant binary names: `tangent-usage`, `tangent-rollup`, and `tangent-eval`. The root `tangent` CLI keeps the short subcommands, but product code is imported only when that command is selected and the package is installed.

Usage is split into dependency-light data packages plus the full `@tangent/usage` app. `@tangent/usage-core` owns schemas/query helpers, datasets, reports, projections, and client construction without UI, SQLite, or built-in provider loading. `@tangent/usage-providers` owns native transcript normalization and provider compatibility. `@tangent/usage-index-sqlite` owns repo/native loading, optional SQLite indexing, status, archive, and compatibility SDK APIs. `@tangent/usage` owns the standalone CLI and local `tangent usage ui` server, which lazily serves `@tangent/usage-ui` assets and framework-agnostic `/api/usage/*` routes. Native provider transcripts are the source of truth for new data. Hook installation and hook recording are retired product surfaces; legacy `capture.source: "hook"` events remain readable through usage-jsonl compatibility. Rollup and Eval consume dependency-light Usage data packages, but Usage must not learn about Rollup or Eval.

Rollup consumes selected Usage turns and visible user messages under the configured length limit, then owns the summarization workflow: `tangent rollup <selector>` caches one period-level `rollup.input.v1` artifact, includes style examples from explicit examples and prior notes, runs one summary provider roll-up, and writes the generated note block. Assistant messages, tool calls, tool results, token metadata, and oversized pasted user messages are intentionally excluded from rollup input. Selectors support single days and compact inclusive ranges. Rollup does not parse Claude or Codex native schemas and does not preserve a topic or turn-digest architecture.

Eval owns local coding-agent evals: specs, contexts, run manifests, agent runs, metrics, reports, diffs, and the local read-only Eval UI server. Eval may read Usage metrics and git artifacts, but it does not upload eval or usage data. The V1 browser UI inspects prepared runs, compares two variants in one case, and diffs task/phase prompts plus materialized context files without running agents. An eval spec may carry an `evaluator` block with a named judge model and a criteria rubric; `collectEval` calls the judge model once per completed variant (via `runners/judge.ts`) and writes an `evaluation.json` sidecar with binary pass/fail verdicts per criterion. The UI reads the sidecar to show score chips and a per-criterion Scoring section.

Eval also owns the mark loop's capture surface (`packages/eval/src/marks/`): the `tangent.mark.v1` record, a per-file JSON store under `~/.tangent/marks/`, and Claude session resolution reused from Usage's transcript discovery. `tangent mark` is a top-level root command, not nested under `tangent eval`, but is implemented and lazily loaded from `@tangent/eval/cli` like the other product stubs. Marks are the connecting artifact from noticing an agent failure (or mining a telemetry exemplar) to proving a fix through the existing eval machinery; see ADR-0015 and `docs/superpowers/specs/2026-07-05-mark-loop-design.md`.

Tangent UI is the Svelte `@tangent/tangent-ui` shell plus product-owned embedded UI bundles. The root `tangent ui` command discovers installed product `tangent.uiApp` descriptors, serves the shell, exposes `/api/ui/apps`, and mounts product assets under `/apps/<app>/`. `@tangent/usage-ui` and `@tangent/eval-ui` expose embedded bundles for the combined shell. API-only Usage consumers can install `@tangent/usage-schema` and `@tangent/usage-core` without Svelte, Vite, browser assets, or SQLite. Local product servers use `@tangent/ui-server` to serve compiled assets, optional workspace Vite middleware, and framework-agnostic JSON API routes.
