# Tangent Architecture

Tangent is a monorepo for local coding-agent applications. The root CLI owns the human command taxonomy and composes installed vertical apps through lazy command imports.

Read next:
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/architecture/layering.md
- docs/architecture/hooks.md
- docs/architecture/agent-runtime.md

Core rule: vertical apps stay independent. Shared infrastructure lives in platform packages, not in Usage and not copied app-to-app.

Install rule: Tangent stays in one git monorepo, but each vertical app package must be publishable and usable on its own. Standalone installs may depend on platform packages and, for Rollup/Eval/Threads, dependency-light Usage data packages, but must not pull unrelated vertical apps or Usage UI packages. Package manifests use normal semver `@tangent/*` dependency ranges; workspace-local `file:`, `link:`, and `workspace:` dependency specs are not allowed in publishable manifests.

Allowed dependency shape:

```text
root CLI
  -> core

installed app packages
  -> agent-shell/server | agent-shell vault CLI | usage SDK/CLI/server | rollup SDK/CLI | eval CLI/server | search SDK/CLI | governance CLI

agent-shell -> agent-runtime, core, repo
rollup -> usage-index-sqlite, core, repo, agent-runtime
eval  -> usage-index-sqlite, core, repo, agent-runtime, ui-server, eval-ui
usage -> usage-core, usage-index-sqlite, usage-providers, core, repo, ui-server, usage-ui, usage-ui-data
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
ui-primitives -> ui-tokens
ui-components -> ui-primitives
ui-patterns -> ui-components, ui-primitives
ui-charts -> ui-components, ui-primitives
ui-code -> ui-components, ui-primitives
ui-app-shell -> ui-patterns, ui-components, ui-primitives
product-ui -> product-ui-data, ui-* packages
product-server -> product-core/API routes, product-ui assets, ui-server
```

Human-facing root commands include `setup`, `status`, `process`, `usage`, `rollup`, `search`, `eval`, `mark`, `doctor`, and `completion`.

The root-owned `process` command resolves inherited `.processes.json` definitions. It manages Area-bound tmux sessions and composes the personal tree. It is not reusable.

Raw, debug, and CI commands remain callable but hidden from default help.

Standalone package CLIs use collision-resistant binary names: `tangent-usage`, `tangent-search`, `tangent-rollup`, and `tangent-eval`. The root `tangent` CLI keeps the short subcommands, but product code is imported only when that command is selected and the package is installed.

Usage is split into dependency-light data packages plus the full `@tangent/usage` app. `@tangent/usage-core` owns schemas/query helpers, datasets, reports, projections, and client construction without UI, SQLite, or built-in provider loading. `@tangent/usage-providers` owns native transcript normalization and provider compatibility. `@tangent/usage-index-sqlite` owns repo/native loading, optional SQLite indexing, status, archive, and compatibility SDK APIs. `@tangent/usage` owns the standalone CLI and local `tangent usage ui` server, which lazily serves `@tangent/usage-ui` assets and framework-agnostic `/api/usage/*` routes. Native provider transcripts are the source of truth for new data. Hook installation and hook recording are retired product surfaces; legacy `capture.source: "hook"` events remain readable through usage-jsonl compatibility. Rollup, Eval, and Threads consume dependency-light Usage data packages, but Usage must not learn about Rollup, Eval, Search, or Threads.

Rollup consumes selected Usage turns and visible user messages under the configured length limit, then owns the summarization workflow: `tangent rollup <selector>` caches one period-level `rollup.input.v1` artifact, includes style examples from explicit examples and prior notes, runs one summary provider roll-up, and writes the generated note block. Assistant messages, tool calls, tool results, token metadata, and oversized pasted user messages are intentionally excluded from rollup input. Selectors support single days and compact inclusive ranges. Rollup does not parse Claude or Codex native schemas and does not preserve a topic or turn-digest architecture.

Eval owns local coding-agent evals: specs, contexts, run manifests, agent runs, metrics, reports, diffs, and the local read-only Eval UI server. Eval may read Usage metrics and git artifacts, but it does not upload eval or usage data. The V1 browser UI inspects prepared runs, compares two variants in one case, and diffs task/phase prompts plus materialized context files without running agents. An eval spec may carry an `evaluator` block with a named judge model and a criteria rubric; `collectEval` calls the judge model once per completed variant (via `runners/judge.ts`) and writes an `evaluation.json` sidecar with binary pass/fail verdicts per criterion. The UI reads the sidecar to show score chips and a per-criterion Scoring section.

Eval also owns the mark loop's internal modules (`packages/eval/src/marks/`): the `tangent.mark.v1` record, a per-file JSON store under `~/.tangent/marks/`, mark-to-eval promotion, and Claude session resolution reused from Usage's transcript discovery. These back the Eval UI's marks inbox (`packages/eval/src/server/marks-routes.ts`) directly. The `tangent mark` root CLI command that used to front this store was removed 2026-08-15 (ADR-0020); marks are the connecting artifact from noticing an agent failure (or mining a telemetry exemplar) to proving a fix through the existing eval machinery; see ADR-0015 and `docs/superpowers/specs/2026-07-05-mark-loop-design.md`.

Search owns structural indexing and search over TypeScript and Dart source: a SQLite index per repo, symbol/callers/callees/tests/skeleton/open-plan lookups, and a standalone CLI plus SDK. It is a standalone vertical: it does not depend on Usage, Rollup, or Eval, and none of those may depend on it. It is the subject of the mark loop's flagship eval (phase 2c), which mines information-heavy Usage sessions and compares a `baseline` variant against a `with-search` variant to prove or refute the tool's value.

`@tangent/agent-shell` owns the vault CLI, the agent messaging CLI, the worker handover CLI (`tangent handover`), the pipeline CLI, the brain CLI, the server CLI, and `tangent study`. The Agent Shell server owns pipelines, Area brains, and durable brain requests. The nearest live Area brain is the control plane for managed work in its subtree. Workers report facts; the brain selects the next assignment. Agent-originated Goal creation and launch require an approved plan request. Legacy work without a brain can still use automatic pipeline advance during migration. See ADR-0029, ADR-0024, and ADR-0023.

The package is lazily loaded from `@tangent/agent-shell/cli` as the root `tangent area`, `tangent brain`, `tangent goal`, `tangent idea`, and `tangent vault` commands (ADR-0020). `area`/`goal`/`idea` are thin HTTP clients to the running Agent Shell server (`packages/agent-shell/app/server.mjs`), the vault's single writer, mirroring `goal-command.mjs`'s local-server contract. `vault commit` is the one exception: it commits directly to `~/.tangent/trees` with `@tangent/repo`'s `git()`, producing the same `<verb>: <area> <summary>` message and `Tangent-Area`/`Tangent-Tmux` trailers as the server's own `vaultCommit()`.

Agent Shell is the daily work product. The app in `packages/agent-shell/app/` connects Areas, Goals, Documents, tmux sessions, and attention signals. Its HTTP boundary is a set of capability route tables; `server.mjs` composes domain operations and dispatches requests. The server owns the desk projection, background scheduler, durable JSON stores, vault mutation repository, and terminal transport. Browser code uses explicit ES modules and renders the server projection. Its main loop is Work, Summary, Agent, and Next step. The native agent interface remains the only chat surface. Work-definition conversations are first-class agent Runs in the normal attention groups, and several can run independently. Confirmed Goal structures go through a deterministic command backed by the server's validated writer. Agents do not hand-author Goal schema. Legacy Outcome records remain readable during migration. The Document reader shows one centered Document without a permanent left rail. History controls and a compact picker connect nearby Documents. A quiet page outline gives section navigation. Open agent replaces the reader, and Back restores the same Document. Areas provide a durable subject hierarchy. Goals record desired changes at any useful level. A Goal can link to Subgoals that answer “To do that.” Documents link to Goals and remain in their Area. Search indexes each Document with its linked Goal history. The server writes a proposed Goal structure only after user confirmation. The app starts one agent or a pipeline of steps on each Goal from the same launch popover, and shows pipeline progress on the Goal row.

There is no combined browser shell. ADR-0019 deleted the former launcher, shell package, and manifest discovery. Do not restore them. The separate Agent Shell app keeps browser-domain logic in explicit product modules and uses its `shell.js` entry point only to coordinate state, rendering, and interaction.

Usage and Eval keep standalone local UI servers: `tangent usage ui` and `tangent eval ui`. These servers use `@tangent/ui-server`.

API-only Usage consumers can install `@tangent/usage-core`. It does not require Svelte, Vite, browser assets, provider loaders, or SQLite, and its `schema` export is the canonical Usage type surface.

The Agent Shell browser uses dependency-injected ES-module factories. Product modules own the Work desk and search, Area directory, Programs, Goal creation and launch editing, agent and decision screens, Document rendering and comments, terminal lifecycle, navigation interactions, and event binding. `public/shell.js` composes those factories and owns active-screen selection plus refresh and paint coordination.
