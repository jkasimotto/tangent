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

agent-shell -> agent-runtime, core, repo, React, Excalidraw
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

Human-facing root commands include `setup`, `status`, `service`, `usage`, `rollup`, `search`, `eval`, `doctor`, and `completion`.

The root-owned `service` command resolves inherited `.processes.json` definitions for servers and watchers. It manages Area-bound tmux sessions (kind `process`) and composes the personal tree. It is not reusable. `tangent process start|stop|restart|close` still reach it for one release with a hint.

`tangent process` is repeatable work. A process is a `<area>/process-<slug>.md` note. The Agent Shell server is its scheduler: when a process is due, the server writes one note to the Area brain, which starts the work as a Goal. A note with `every:` alone is a loop: the brain gets its body as a message every so often while it runs. The root `trigger` command and its LaunchAgent are retired. See ADR-0043.

Raw, debug, and CI commands remain callable but hidden from default help.

Agent Shell centers each Area on one logical brain. The vault owns Area knowledge, and each bound repository owns code-agent instructions.

Each Area can store one Excalidraw scene at `<area>/<leaf>.excalidraw`. Plain-text notes own referenced facts. Julian owns scene geometry, style, and ink. Tangent entity blocks use `customData.tangent` only to address their authoritative source (ADR-0049).

Agent Shell embeds the upstream Excalidraw editor as a bundled browser island. It saves a complete scene through a hash-checked, path-limited repository boundary. Fact refresh changes only the displayed cache and does not dirty the scene. Runtime records hold brain pictures, proposals, and promotion progress (ADR-0049).
Area skills live at `<area>/.agents/skills/<name>/SKILL.md`. Tangent creates `<area>/.claude/skills` as a relative link, so Codex and Claude discover the same inherited files. Legacy `skill-<slug>.md` Documents remain readable during migration. See ADR-0045.
Agent Shell derives inherited sources by path. It owns bounded runtime projections, Journal delivery, Requests, Goal queues, presented-document attention, and Operation health.
Each Area can declare allowed agent launches. Child policies intersect with parent policies. Agent Shell remembers the last successful Brain and Work launch separately.
Presented-document records stay outside the vault and Goal queue. Opening a presented document clears its Work row. Closing the Goal removes its record.
One budget covers every character Agent Shell generates for a brain prompt; only Julian's own founding instruction sits outside it.
Work infers no ask. A Question exists only when a brain writes a Request, and it stays with that brain: a quiet count on the Area header, and a deliberate review behind it.
Every Goal closure and every dropped Goal records one material milestone, so a brain's recent-work view matches what happened.

Standalone package CLIs use collision-resistant binary names: `tangent-usage`, `tangent-search`, `tangent-rollup`, and `tangent-eval`. The root `tangent` CLI keeps the short subcommands, but product code is imported only when that command is selected and the package is installed.

Usage is split into dependency-light data packages plus the full `@tangent/usage` app. `@tangent/usage-core` owns schemas/query helpers, datasets, reports, projections, and client construction without UI, SQLite, or built-in provider loading. `@tangent/usage-providers` owns native transcript normalization and provider compatibility. `@tangent/usage-index-sqlite` owns repo/native loading, optional SQLite indexing, status, archive, and compatibility SDK APIs. `@tangent/usage` owns the standalone CLI and local `tangent usage ui` server, which lazily serves `@tangent/usage-ui` assets and framework-agnostic `/api/usage/*` routes. Native provider transcripts are the source of truth for new data. Hook installation and hook recording are retired product surfaces; legacy `capture.source: "hook"` events remain readable through usage-jsonl compatibility. Rollup, Eval, and Threads consume dependency-light Usage data packages, but Usage must not learn about Rollup, Eval, Search, or Threads.

Rollup consumes selected Usage turns and visible user messages under the configured length limit, then owns the summarization workflow: `tangent rollup <selector>` caches one period-level `rollup.input.v1` artifact, includes style examples from explicit examples and prior notes, runs one summary provider roll-up, and writes the generated note block. Assistant messages, tool calls, tool results, token metadata, and oversized pasted user messages are intentionally excluded from rollup input. Selectors support single days and compact inclusive ranges. Rollup does not parse Claude or Codex native schemas and does not preserve a topic or turn-digest architecture.

Eval owns local coding-agent evals: specs, contexts, run manifests, agent runs, metrics, reports, diffs, and the local read-only Eval UI server. Eval may read Usage metrics and git artifacts, but it does not upload eval or usage data. The V1 browser UI inspects prepared runs, compares two variants in one case, and diffs task/phase prompts plus materialized context files without running agents. An eval spec may carry an `evaluator` block with a named judge model and a criteria rubric; `collectEval` calls the judge model once per completed variant (via `runners/judge.ts`) and writes an `evaluation.json` sidecar with binary pass/fail verdicts per criterion. The UI reads the sidecar to show score chips and a per-criterion Scoring section.

Eval also owns the mark loop's internal modules (`packages/eval/src/marks/`): the `tangent.mark.v1` record, a per-file JSON store under `~/.tangent/marks/`, mark-to-eval promotion, and Claude session resolution reused from Usage's transcript discovery. These back the Eval UI's marks inbox (`packages/eval/src/server/marks-routes.ts`) directly. The `tangent mark` root CLI command that used to front this store was removed 2026-08-15 (ADR-0020); marks are the connecting artifact from noticing an agent failure (or mining a telemetry exemplar) to proving a fix through the existing eval machinery; see ADR-0015 and `docs/superpowers/specs/2026-07-05-mark-loop-design.md`.

Search owns structural indexing and search over TypeScript and Dart source: a SQLite index per repo, symbol/callers/callees/tests/skeleton/open-plan lookups, and a standalone CLI plus SDK. It is a standalone vertical: it does not depend on Usage, Rollup, or Eval, and none of those may depend on it. It is the subject of the mark loop's flagship eval (phase 2c), which mines information-heavy Usage sessions and compares a `baseline` variant against a `with-search` variant to prove or refute the tool's value.

`@tangent/agent-shell` owns the vault CLI, agent messages, worker notes, Area brains, and `tangent study`.
Each Area brain has one logical identity.
Its durable generation history identifies every brain session. A brain controls Goal work, but it never owns a Goal or becomes a Goal attempt.
Its lifecycle is active or inactive. Process attempts and recovery are diagnostic health.
The server owns its activation envelope, bounded prompt, subtree milestones, Journal, Requests, exact-Area Goal queue, and Operation event outbox.
Each generation stores its complete resolved launch. A user-selected registry choice applies to one start or resume attempt without changing the Area default; reattachment keeps the live launch, and automatic recovery or handover resolves the current default.
Each accepted worker note (`tangent send brain`) adds a receipt to that Goal queue before it writes one exact-Area inbox notice. A pending receipt is a durable notice outbox, and a stable source ID makes retry and recovery idempotent.
A `question-needed` report also owns durable question state in the Goal queue. The exact live Area brain answers through `tangent send <worker>`. The answer commits before delivery and transfers to the current replacement attempt. The waiting worker reads it as command output through an exact question wait channel, so delivery does not use a composer. Rebuilt worker prompts include open questions and committed answers. See ADR-0050.
Any harness can pull a rebuilt brain or worker prompt from the session's durable record. Current brain context also carries unread exact-Area notices. A bound worker observed back at its shell creates one durable recovery notice without ending its queue assignment or tmux session.
Generic `tangent send` messages use an atomic file queue. Agent Shell stores them before pane wake or presentation and restores them after controller restarts. See ADR-0039.
Area paths organize records and inboxes; they do not grant command permission. Any local caller can mutate work in any Area through the same server routes. The server records actor provenance and sends a durable event to the target Area after commit. Queue revisions, live ownership, exact attempts, and immutable tmux targets remain fences.
Journal capture writes before delivery.
Exact Request effects use hashed revisions and an allowlist.

Agent Shell assigns each keyboard event to one visible context. A terminal owns all input except its visible leave action. Work uses one open-Goal projection and a shared command registry. Documents provide a Vim-style reading mode without taking keys from text editors. See ADR-0038.
A designated typed final review can close routine Goals at the current Goal revision.
Material Operation Problems, resolutions, and declared results persist before brain delivery.
Detached audit exports preserve old generation and pipeline records.
A worker assignment that names no harness takes the calling brain's own launch, and the server discloses that choice in the queue record before it creates the session; a caller that is not the exact live brain is still refused.
The old Program API is available only with `TANGENT_LEGACY_PROGRAM_API=1`.
Each Agent Shell runtime has one stable instance identity. Every new tmux worker and brain carries that identity in `@tangent_agent_shell_instance`. Explicit resume can claim an exact pre-marker brain when its durable record matches all live brain tags.

The controller derives one server-authoritative state word for each worker and Area brain. Durable queue facts take priority over fresh transcript and pane observations. Stale observations become `Unknown`. Work and `tangent agent list` use the same word, owner, evidence, and next actor.

A stopped Area brain does not strand live work. The controller can dispatch one leased repair crew for the exact Area after a three-minute grace period. The crew has bounded authority, a durable command audit, immutable tmux fencing, and a two-attempt stop budget. A live Area brain supersedes it. A block or spent budget creates one existing Work blocker instead of a separate request pile. See ADR-0047.
Only the session ownership capability can terminate tmux sessions, and it verifies the immutable tmux session ID before termination.
Foreign and arbitrary markerless sessions remain alive. Reconciliation uses durable owner sidecars only for the current instance.
See ADR-0033, ADR-0034, ADR-0035, and ADR-0036.

The package is lazily loaded from `@tangent/agent-shell/cli` as the root `tangent area`, `tangent brain`, `tangent goal`, `tangent idea`, and `tangent vault` commands (ADR-0020). `area`/`goal`/`idea` are thin HTTP clients to the stable Agent Shell gateway on port 4321; the gateway proxies them to the controller in `packages/agent-shell/app/server.mjs`, the vault's single writer. `vault commit` is the one exception: it commits directly to `~/.tangent/trees` with `@tangent/repo`'s `git()`, producing the same `<verb>: <area> <summary>` message and `Tangent-Area`/`Tangent-Tmux` trailers as the controller's own `vaultCommit()`.

Agent Shell is the daily work product. The app in `packages/agent-shell/app/` connects Areas, Goals, Documents, tmux sessions, and attention signals. `gateway.mjs` owns the public listener, static assets, SSE, and terminal transport. It supervises the replaceable `server.mjs` controller over an ephemeral loopback port and IPC heartbeat (ADR-0032). Gateway and controller share one runtime identity, which remains stable across replacement. Every terminal attachment and process termination checks that identity through `session-ownership.mjs` (ADR-0036). The controller's HTTP boundary is a set of capability route tables. Stateful launch, message-delivery, pane-observation, vault, and record mechanisms own their state behind narrow factories (ADR-0031). Browser code uses explicit ES modules. `shell.js` composes feature-owned ports, and the shell coordinator handles cross-feature navigation without flat dependency lists or service bags. One browser refresh coordinator serializes projection reads from SSE, timers, mutations, and direct actions. It tracks gateway, controller, transport, and retry state separately. The controller projection remains authoritative for durable work; the gateway can serve its last valid session projection while the controller recovers. Vault Markdown and workflow records stay readable while private module and loopback contracts may change atomically with their callers.

There is no combined browser shell. ADR-0019 deleted the former launcher, shell package, and manifest discovery. Do not restore them. The separate Agent Shell app keeps browser-domain logic in explicit product modules and uses its `shell.js` entry point only to coordinate state, rendering, and interaction.

Usage and Eval keep standalone local UI servers: `tangent usage ui` and `tangent eval ui`. These servers use `@tangent/ui-server`.

API-only Usage consumers can install `@tangent/usage-core`. It does not require Svelte, Vite, browser assets, provider loaders, or SQLite, and its `schema` export is the canonical Usage type surface.

The Agent Shell browser uses dependency-injected ES-module factories. Product modules own calm Work, Areas, Operations, Goal launch, Documents, terminal lifecycle, and navigation. `public/shell.js` is the composition root.
