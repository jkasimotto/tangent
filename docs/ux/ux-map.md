# Tangent UX Map

Every user touchpoint across the three product surfaces — **Usage**, **Trees**, **Eval** — drawn as a graph, plus the common workflows that thread through them. "Touchpoint" means anything a user acts on: a CLI command or flag, a clickable element, a search/filter input, an MCP tool, an HTTP endpoint.

Source of truth: this is reverse-engineered from the code. File:line references are inline so each node is traceable.

---

## 0. The shell that ties them together

Three front ends, one shell. Each surface ships a CLI, and Usage/Eval also ship an embedded web UI mounted inside one combined browser shell. Trees ships its own web UI on its own server.

### Entry points

| You type | What starts | Source |
|---|---|---|
| `tangent <surface> …` | the surface's CLI | `src/cli/index.ts:66-94` |
| `tangent-usage` / `tangent-trees` / `tangent-eval` | the standalone per-surface CLI bin | each package `package.json` `bin` |
| `tangent ui [usage\|trees\|eval]` | combined browser shell (app switcher) | `src/cli/index.ts:56`, `src/cli/product.ts:208` |
| `tangent usage ui` / `tangent eval ui` | that surface's UI server, standalone | `usage/src/cli/ui.ts`, `eval/src/cli/commands/ui.ts` |
| `tangent trees` UI | served by `trees-server` at `/trees` | `trees-server/src/index.ts:30` |
| `tangent open {agent\|project\|setup}` | a terminal/agent session | `src/cli/product.ts:76-97` |
| `tangent setup` / `status` / `doctor` / `completion` | cross-surface config & health | `src/cli/product.ts`, `src/cli/index.ts` |

### Shell internals

- **App switcher** (`tangent-ui/src/App.svelte:121-136`): a `Switch Tangent app` button → menu listing installed apps. Click an app → `selectApp()` → URL pushState → mounts that app's `mountApp` bundle.
- **Discovery**: apps self-register via `tangent.uiApp` in their `package.json` (`src/cli/ui-discovery.ts:136`). Usage = order 10, Eval = order 30. **Trees does not register here** — it runs on `trees-server`, a separate process.
- **Server** (`ui-server/src/index.ts`): `/healthz`, `/api/ui/apps` (the app list), `/api/*` route dispatch, static + Vite-dev asset mounts.

```mermaid
graph TD
  user([User])
  user -->|tangent ui| shell[Combined UI shell<br/>app switcher]
  user -->|tangent usage ui| usageUI
  user -->|tangent eval ui| evalUI
  user -->|tangent trees / trees-server| treesUI
  user -->|tangent usage …| usageCLI[Usage CLI]
  user -->|tangent trees …| treesCLI[Trees CLI]
  user -->|tangent eval …| evalCLI[Eval CLI]
  user -->|trees mcp| treesMCP[Trees MCP server]

  shell -->|/api/ui/apps| usageUI[Usage UI<br/>order 10]
  shell -->|/api/ui/apps| evalUI[Eval UI<br/>order 30]

  evalUI -.->|Open flamegraph<br/>/usage?conversation=| usageUI

  subgraph CLIs
    usageCLI
    treesCLI
    evalCLI
  end
  subgraph WebUIs
    usageUI
    evalUI
    treesUI
  end
```

The only cross-surface UI edge is **Eval → Usage**: the "Open flamegraph" link jumps from a variant's metrics into that conversation's Usage telemetry.

---

## 1. Usage surface

Local conversation telemetry. CLI (`tangent usage`) + a single-page Svelte UI with two modes (browse gallery → read view). No MCP. Spec: `usage/src/cli/spec.ts`.

### 1.1 Graph

```mermaid
graph TD
  subgraph CLI
    today[usage today]
    sessions[sessions list/get/report/timeline]
    msgs[messages query/search]
    steps[steps query/timeline]
    tools[tools query]
    tokens[tokens summary]
    analytics[analytics aggregate/series]
    rawx[raw events / export]
    reindex[reindex / index rebuild]
    importn[import-native]
    archive[archive]
    health[status / doctor / providers / native]
    uicmd[usage ui]
  end

  reindex --> idx[(SQLite index)]
  importn --> idx
  idx --> today
  idx --> sessions
  idx --> uicmd

  uicmd --> browse

  subgraph UI[Usage SPA - App.svelte]
    browse[Browse gallery<br/>mode=browse]
    read[Read view<br/>mode=read]
    search{{Search input}}
    flame[Flame band]
    transcript[Transcript pane]
    bottle[Bottlenecks aside]
  end

  search -->|filterSessions| browse
  browse -->|click session card<br/>openSession| read
  read -->|back| browse
  read --> flame
  read --> transcript
  read --> bottle
  flame <-->|activeSegmentId| transcript
  bottle -->|jumpToBottleneck<br/>scrolls flame| flame
  bottle -->|Mark for eval ★<br/>STUB / no-op| stub((coming soon))
```

### 1.2 CLI touchpoints

Handlers: `usage/src/cli/usage.ts`, `resource-commands.ts`, `ui.ts`. Nearly all take `--json`; resource commands also take `--repo`, `--provider claude|codex|all`, `--source native|all|usage-jsonl`, `--format json|csv|vega-lite`.

| Command | Args / key flags | Does | Line |
|---|---|---|---|
| `init [repo]` | `--provider` | Check native capture capability | `usage.ts:68` |
| `status [repo]` | `--verbose` | Capture health + capability coverage | `usage.ts:75` |
| `ui [session\|latest]` | `--repo --scope --host --port --no-browser --static-ui --provider --source` | **Start UI server, open browser** (the CLI→UI bridge) | `ui.ts:5` |
| `today [repo]` | `--provider --source` | Today's sessions, reverse-chron | `usage.ts:89` |
| `session <id\|latest>` (hidden) | — | One session summary | `usage.ts:107` |
| `report <id\|latest>` (hidden) | — | Assistant-centered report | `usage.ts:120` |
| `transcript <id\|latest>` (hidden) | `--internal` | Readable transcript | `usage.ts:133` |
| `reindex [repo]` (hidden) | `--provider --force --source` | **Rebuild SQLite index** | `usage.ts:184` |
| `export [repo]` | `--since --until --provider --source` | Normalized events → JSONL | `usage.ts:202` |
| `events [repo]` (hidden) | — | Raw normalized events JSON | `usage.ts:214` |
| `doctor [repo]` (hidden) | `--trace` | Verbose diagnostics | `usage.ts:301` |
| `index rebuild [repo]` | `--force --provider --source` | Write SQLite index | `resource-commands.ts:11` |
| `providers list` / `inspect <p>` | — | Provider capabilities | `:21` `:27` |
| `sessions list [repo]` | `--provider --date --since --until --source --format` | Filterable session list | `:33` |
| `sessions get/report <id>` | — | Session detail / report | `:45` `:51` |
| `sessions timeline <id>` | `--metric duration\|self-duration\|tokens\|cost --group … --format vega-lite` | Timeline / chart spec | `:57` |
| `messages query` | `--session --role --min-chars --contains --limit --format` | Filter messages | `:68` |
| `messages search <query>` | `--provider --limit` | Full-text search | `:83` |
| `steps query` | `--session --kind --order --limit` | Query steps | `:93` |
| `steps timeline` | `--session --metric` | Step timeline | `:106` |
| `tools query` | `--session --name --include-results none\|preview\|full --limit` | Query tool calls | `:116` |
| `tokens summary` | `--by model\|provider\|session\|step-kind --session` | Token breakdown | `:129` |
| `analytics aggregate` | `--group (rep) --metric (rep)` | Aggregate | `:140` |
| `analytics series` | `--bucket day\|hour --group --metric` | Time series | `:150` |
| `raw events` | `--session --kind --ndjson` | Raw events | `:160` |
| `native schemas / inspect <path> / status` (hidden) | — | Native log introspection | `usage.ts:243-264` |
| `archive [repo]` (hidden) | `--before <date>` (req) `--dry-run --provider` | **Move old telemetry to archive** | `usage.ts:267` |
| `import-native [repo]` (hidden) | `--provider` | **Import transcripts + reindex** | `usage.ts:285` |

### 1.3 UI clickables (`usage-ui/src/App.svelte`)

- **Browse**: session card button → `openSession` → read view (`:452`).
- **Read top bar**: `← All conversations` back (`:471`); session-id chip `⧉` → copy to clipboard (`:476`); zoom `−` / `+` / level label (`:490-492`).
- **Flame band**: turn prompt button → `activateRow` (`:508`); per-step segment button → `activateSegment` (`:519`); empty-turn segment (`:535`). Bottleneck segments marked visually.
- **Transcript pane**: "Thinking" `<details>` (`:569`); `Show full message`/`Show less` toggle (`:574`); "Proposed plan" `<details>` (`:596`); tool `Details`/`Hide` toggle → reveals command/dir/output (`:602`).
- **Bottlenecks aside**: `◀` prev / `▶` next (`:648`); bottleneck row → `jumpToBottleneck` → activates segment + scrolls flame (`:656`); `★ Mark for eval` → **no-op stub** (`:666`).

### 1.4 Search / filter / sort

- **Search input** (`:447`, "Project or session") → `filterSessions` client-side on title/provider/model, and the same `query` scopes the loaded conversation fetch.
- **Sort**: no UI control. Sessions server-sorted `lastActivityAt desc`. Bottlenecks pre-ranked by data layer.
- **Keyboard shortcuts**: none.

### 1.5 Endpoints (`usage/src/server/index.ts`, all GET, `/api/usage/*`)

| Endpoint | Wired in UI? | Line |
|---|---|---|
| `/selection` | indirect | `:188` |
| `/sessions?provider&limit` | **yes** (gallery + 2s poll) | `:192` |
| `/sessions/:id` | latent | `:201` |
| `/sessions/:id/cockpit` | latent | `:202` |
| `/sessions/:id/conversation-view?query&limit` | **yes** (read view) | `:205` |
| `/sessions/:id/timeline-view` | latent | `:211` |
| `/sessions/:id/timeline?metric` | latent | `:217` |
| `/sessions/:id/transcript?includeTools` | latent | `:220` |
| `/messages/selection` | latent | `:225` |
| `/providers` | latent | `:232` |

`:id` accepts `latest`/`selected`. **Only 2 of 10 endpoints are exercised by the UI** — the rest, plus `getSession.nextActions` hrefs (timeline/compare/evidence/rollup/export), are dormant. Live update: server watches native transcript dirs and rebuilds in place; client polls every 2s (`LIVE_REFRESH_MS`) and swaps only on signature change, preserving scroll.

---

## 2. Trees surface

Semantic work trees, worktrees, agents, attention. Three parallel front ends over one `TreesClient` store: **CLI** (`tangent trees`), **MCP** (agent-controllable), and a two-tab Svelte UI (Trees builder + Worklog) on `trees-server`. Spec: `trees-cli/src/spec.ts`, dispatch `trees-cli/src/index.ts`.

### 2.1 Graph

```mermaid
graph TD
  subgraph CLI
    entity[init/add/show/list/set/mv/rm]
    center[center / events / import-pa]
    proj[project list/add/rm]
    wt[worktree ensure/path/status]
    agent[agent start/send/status/stop/watch]
    term[terminal open/attach/capture/send]
    attn[attention list/ack/resolve/dismiss]
    sess[session start/checkpoint/list]
    cap[capture add/list/resolve]
    mcpcmd[trees mcp]
  end

  store[(TreesClient store)]
  entity --> store
  proj --> store
  attn --> store
  sess --> store
  cap --> store
  agent --> store
  agent -->|auto-spawn| watch[agent watch<br/>notify on done/needs-input]

  mcpcmd --> mcp[MCP stdio server<br/>20 tools]
  mcp --> store

  subgraph UI[trees-server /trees - App.svelte]
    tabTrees[Tab: Trees]
    tabWork[Tab: Worklog]
    addform{{Add-path form}}
    treelist[Tree rows + disclosure]
    insp[Inspector]
  end
  store -->|GET /api/trees/workspace| tabTrees
  addform -->|POST entities/path| treelist
  treelist -->|select entity| insp
  treelist -->|select session| insp
  insp -->|Start work| launcher[/api/launcher<br/>NOT in repo/]
  insp -->|Log past work| worklog[/api/worklog<br/>NOT in repo/]
  tabWork --> worklog
```

### 2.2 CLI touchpoints

Root `trees`; most commands take `--json`.

- **Entities**: `init`; `add <path> --kind --project --branch --worktree`; `show <path|id>`; `list [path] --status --attention`; `set <path|id> <field> <value>`; `mv <src> <dst>`; `rm <path|id> --worktree --branch --force` (**requires `--force`**). (`spec.ts:7-13`)
- **Command center**: `center [path]` (count + open attention + active agents + top-10); `events --watch --json` (re-prints every 5s); `import-pa --from --dry-run` (migrate legacy `~/.wt`); `mcp` (start MCP server with dangerous tools + worktree capability). (`spec.ts:53-56`)
- **project**: `list` / `add [name] <path>` / `rm <name>`. (`spec.ts:14-17`)
- **worktree**: `ensure <ref>` / `path <ref>` / `status <ref>`. (`spec.ts:19-22`)
- **agent**: `start <ref> --agent --model --prompt --runtime --intent --estimate --done-when` (builds terminal, runs adapter, records `AgentRun`, **auto-spawns `agent watch`**); `send <run|path> <msg|->`; `status [path]`; `stop <ref>`; `watch <run>`. Adapters: `manual`, `codex-cli` (default), `claude-cli`, `gemini-cli`, `custom-command`. Runtimes: `process`, `tmux` (default). (`spec.ts:24-29`)
- **terminal**: `open` / `attach` / `capture --lines` / `send <text|->`. (`spec.ts:31-35`)
- **attention**: `list --kind --severity` / `ack <id>` / `resolve <id> --note` / `dismiss <id> --reason`. (`spec.ts:37-41`)
- **session**: `start <ref> --intent --estimate --done-when` / `checkpoint <ref> --outcome --did --learned --evidence --next --blocker --capture-id` / `list <ref>`. (`spec.ts:43-46`)
- **capture**: `add --entity --kind --text/--stdin` / `list --entity --all` / `resolve <id> --checkpoint/--dismiss --note`. (`spec.ts:48-51`)

### 2.3 MCP tools (`trees-mcp/src/index.ts:38-71`)

JSON-lines stdio; every call logs `mcp.toolCalled`. **Dangerous** tools need `allowDangerous` (the `trees mcp` command enables it). Non-dangerous: `trees_survey`, `trees_get_entity`, `trees_create_entity`, `trees_update_entity`, `trees_move_entity`, `trees_worktree_status`, `trees_capture_terminal`, `trees_list_attention`, `trees_ack_attention`, `trees_resolve_attention`, `trees_start_session`, `trees_checkpoint_session`, `trees_add_capture`, `trees_list_captures`, `trees_resolve_capture`. Dangerous: `trees_delete_entity`, `trees_ensure_worktree`, `trees_start_agent`, `trees_send_agent`, `trees_stop_agent`. Note: as wired, only `ensureWorktree` capability is injected — the agent/terminal-backed tools throw "capability not enabled" unless a host injects handlers.

### 2.4 UI clickables (`trees-ui/src/App.svelte`)

- **Nav tabs**: `Trees` / `Worklog` (`:565`).
- **Launcher settings** (only if `/api/launcher` responds): driver `<select>` (iTerm2 tab/window, Custom), custom template input, Tmux checkbox → save config (`:585-606`).
- **Add-path form**: path input + `Add` → `addTreePath` → POST create-path → expands + selects (`:609`).
- **Tree rows**: disclosure ▸/▾ → `toggleExpanded` (`:668`); entity select → `selectEntity` (`:679`); session row select → `selectSession` (`:643`); session `×` stop (`:653`).
- **Inspector / entity leaf form**: Project `<select>`, Branch, Worktree inputs; `Save leaf` (`:762`); `Clear metadata` (`:765`); `Delete node` → confirm → `Really delete?` (`:769`) / `Cancel`.
- **Inspector / Start work**: intent input, estimate number + chips 15m/30m/1h/2h, notes textarea; `Open Agent` (`:810`) / `Open Agent in tmux` (`:813`) / `Open Terminal` (`:816`).
- **Inspector / Log past work**: name, estimate(+chips), actual, notes; `Log work` (`:853`).
- **Inspector / session state**: time-taken input, done-note; `Mark done` (`:912`); `Open` (focus) (`:918`); `Close` (stop) (`:919`).
- **Worklog tab**: `Refresh` (`:76`); per pending entry actual input + `Log` → setActual (`:104`).

### 2.5 Search / filter / sort / keyboard

**None.** No search box, no filter, no sortable column, no keyboard shortcuts. Ordering is fixed (entities by semantic path, projects by name, worklog reverse-chron). Only "filtering" is structural expand/collapse.

### 2.6 Endpoints

- **Implemented** (`trees-server/src/index.ts`, `/api/trees/*`): `GET /workspace`; `POST /entities/path`; `POST /entities/:ref/leaf`; `POST /entities/:ref/leaf/clear`; `POST /entities/:ref/delete`. Each mutation returns the refreshed workspace.
- **Consumed but NOT implemented in this repo** (UI degrades gracefully on 404): `/api/launcher/*` (config, sessions, open, stop, focus — primitives exist in `packages/launcher` but no route host); `/api/worklog*` (list, actual, manual create).

The **session ↔ worklog join is implicit** (cwd + start-time proximity, `App.svelte:96`), not a stored key. The UI polls every 2s. The UI exercises only entity-CRUD + leaf config; the full lifecycle (agent/terminal/session/capture/attention) is CLI- and MCP-only.

---

## 3. Eval surface

Coding-agent eval prepare/run/collect/report. CLI (`tangent eval`) + a single-screen master-detail Svelte UI behind a read-only `/api/eval/*` server. Spec: `eval/src/cli/spec.ts`.

### 3.1 Graph

```mermaid
graph TD
  subgraph CLI
    init[eval init]
    ctx[context capture<br/>→ snapshot:ref]
    captask[capture task<br/>→ eval.json + prompt]
    prep[prepare → run id]
    run[run / quick → run id]
    coll[collect]
    rep[report]
    diff[diff A B --phase]
    open[open variant → worktree path]
    uicmd[eval ui]
  end

  captask --> prep --> run
  run --> coll --> rep
  run --> diff
  run --> open
  run --> runid[(run id)]
  uicmd --> ui

  subgraph ui[Eval UI - App.svelte single screen]
    rail[Left rail: spec select + Run + run list]
    header[Run header]
    compare[Case → Config A → Config B]
    variants[Variant strip + sparkline]
    results[Results strip: Time/Peak ctx/Files]
    artifacts[Artifacts: Prompts/Context/Changed]
    diffpane[Diff pane]
  end

  rail -->|click run| header --> compare --> variants
  compare --> results
  compare --> artifacts -->|click artifact| diffpane
  rail -->|Run button| post[POST /api/eval/runs]
  variants -.->|Open flamegraph| usage[Usage app /usage?conversation=]
```

### 3.2 CLI touchpoints (`eval/src/cli/spec.ts`)

Shared agent flags (`commands/shared.ts`): `--agent manual|codex-cli|claude-cli`, `--model gpt-5.4|gpt-5.4-mini|sonnet|haiku|opus`, `--command`, `--profile`, `--sandbox read-only|workspace-write|danger-full-access`, `--permission-mode`, `--timeout-ms`.

| Command | Args / key flags | Does | Line |
|---|---|---|---|
| `init` | — | Create `./evals` dir | `spec.ts:17` |
| `context capture <name>` | `--repo --cwd --include-ancestors --include-dirty-context --from-ref --empty` | Snapshot context → `snapshot:<ref>` | `spec.ts:19` |
| `capture task <id>` | `--prompt <path\|-> (req) --repo --repo-ref --cwd --context --variant (rep) --phases` + agent flags | Scaffold `evals/<id>/eval.json` + prompt | `spec.ts:39` |
| `prepare <eval.json>` | `--json` | Create worktrees + context commits → run id | `spec.ts:59` |
| `run [eval.json]` | `--repo --repo-path --prompt (rep) --context (rep) --phases` + agent flags | Prepare+run+collect, live progress | `spec.ts:60` |
| `quick` | (= run shortcut, needs `--prompt`) | One-shot, no spec file | `spec.ts:74` |
| `collect <run-id>` | `--json` (`latest` ok) | Collect git + usage metrics | `spec.ts:87` |
| `report <run-id>` | `--json` | Collect + print compact report | `spec.ts:88` |
| `diff <run-id> <A> <B>` | `--phase context\|plan\|impl\|all --case` | git diff / range-diff (CLI compare) | `spec.ts:89` |
| `open <run-id> <variant>` | `--case` | Print variant worktree path | `spec.ts:98` |
| `ui [run-id\|latest]` | `--host --port --no-browser --json` | Start UI server | `spec.ts:99` |

Run-id resolves `latest`/`selected` (`commands/shared.ts:71`). All run-producing commands feed one `run id` consumed downstream.

### 3.3 UI clickables (`eval-ui/src/App.svelte`)

- **Spec `<select>`** (`:347`) — pick spec to launch.
- **`Run` button** (`:357`) → `launch` → `POST /api/eval/runs {specPath}` → re-list + select new run. Label → "Starting…".
- **Run list buttons** (`:369`) → `selectRun(id)` → `loadRun`.
- **Case `<select>`** (`:401`) → resets variants, recompare.
- **Config A `<select>`** (`:409`) / **Config B `<select>`** (`:417`) → `loadCompare` when both set.
- **Variant cards A/B** (`:427`, display) with sparkline bars (`:435`).
- **"Open flamegraph" link** (`:440`) → `/usage?conversation=<id>` → **leaves Eval into Usage**.
- **Results-strip rows** (`:449`, display) — Time / Peak context / Files changed with good/bad delta badges.
- **Artifact buttons** — Prompts (`:469`), Context files (`:482`), Changed files (`:495`) → `selectArtifact` → `loadDiff`.
- **Diff pane** (`:507`) — side-by-side add/delete/changed/equal rows.

No menus, tabs, modals, hover-expand, or sortable columns. No keyboard shortcuts. No free-text search — filtering is by selection (run → case → A/B → artifact). Sorting is server-fixed.

### 3.4 Endpoints (`eval/src/server/index.ts`, `/api/eval/*`)

| Method + path | Returns | Line |
|---|---|---|
| `GET /selection` | newest run with variants | `:138` |
| `GET /specs` | spec dropdown data | `:139` |
| `GET /runs` | run list + status counts | `:142` |
| `POST /runs` | 202 + runId; **prepares+runs+collects detached** | `:133` |
| `GET /runs/:runId` | full run detail | `:146` |
| `GET /runs/:runId/compare?caseId&left&right` | both variants + artifact same/changed badges | `:147` |
| `GET /runs/:runId/diff?caseId&left&right&kind&path` | line diff for one artifact | `:148` |

`:runId` accepts `selected`/`latest`. While any variant is `prepared`/`running`, the UI polls `getRun` every 1500ms then reloads compare.

---

## 4. Common workflows

### Cross-surface

1. **Eval → Usage flamegraph dive**: run an eval → in the Eval UI pick run/case/Config A vs B → scan Results strip → click **Open flamegraph** on a variant → land in the Usage read view for that conversation → inspect flame/transcript/bottlenecks. The one wired cross-surface edge.

### Usage

2. **First-run setup**: `tangent setup --usage` → `tangent usage status` → `tangent usage reindex` → `tangent usage today`.
3. **Triage today (CLI)**: `usage today` → copy id → `usage transcript <id>` / `report <id>` → `sessions timeline <id> --metric duration --format vega-lite`.
4. **Visual bottleneck hunt (UI)**: `usage ui` → search project → click card → read view → click slowest bottleneck (flame auto-scrolls, transcript re-scopes) → expand tool Details → back.
5. **Live monitoring**: open `usage ui` on a running agent → file-watch + 2s poll surface new turns without losing scroll.
6. **Export / archive**: `usage export --since --until` (or `tangent data export`); cleanup `usage archive --before <date> --dry-run` then for real.

### Trees

7. **Build a work tree (UI)**: Trees tab → add `area/feature/task` → select leaf → set Project/Branch/Worktree → Save leaf. (CLI: `trees add` / `set` / `project add`.)
8. **Start agent + track time (UI, headline)**: select leaf → Start work (intent + estimate chips) → Open Agent (± tmux) → live session row with ticking estimate bar → Mark done with actual → lands in Worklog with estimate-vs-actual bar.
9. **Start agent (CLI)**: `trees agent start <path> --intent … --estimate … --agent codex-cli --runtime tmux --prompt …` → auto-spawns `agent watch` → monitor `agent status`, drive `agent send`, end `agent stop`.
10. **Triage (CLI)**: `trees center` → `attention list` → `attention ack/resolve/dismiss <id>`.
11. **Capture + checkpoint loop**: `capture add --text …` (or MCP `trees_add_capture`) → `session checkpoint --capture-id …` → `capture resolve <id> --checkpoint <id>`.
12. **Agent-driven (MCP)**: agent over `trees mcp` calls `trees_survey` → `trees_create/update_entity` → `trees_ensure_worktree` → session/capture/attention tools (destructive ops gated by dangerous capability).
13. **Migrate**: `trees import-pa --from ~/.wt --dry-run` then for real.

### Eval

14. **Scaffold → run → compare**: `eval init` → `eval capture task <id> --prompt … --variant a:repo --variant b:snapshot:<ref>` → `eval ui` → pick spec → Run → poll → compare A/B artifacts/metrics.
15. **One-shot quick**: `eval quick --prompt p.md --context repo --context snapshot:<ref> --agent codex-cli` → `eval report latest` or `eval ui latest`.
16. **Manual prepare**: `eval prepare eval.json` → run agents by hand in printed worktrees → `eval collect <id>` → `eval report <id>`.
17. **Deep CLI compare**: `eval run eval.json` → `eval diff <id> a b --phase impl` (range-diff) + `eval open <id> a` to cd in.
18. **Context A/B**: `eval context capture base --from-ref HEAD` → reference `snapshot:<ref>` in a `--variant`/`--context` to compare with-vs-without context.

---

## 5. Notable gaps (model these as soft/dormant edges)

- **Trees UI depends on two unimplemented servers** — `/api/launcher/*` and `/api/worklog*` have no route host in this repo. The UI degrades gracefully (hides launcher chrome, empty worklog) when they 404. "Start work" / "Log work" / session focus-stop only function once a host wires those routes.
- **Usage UI uses only 2 of 10 endpoints.** The other 8, plus `getSession.nextActions` hrefs (timeline/compare/evidence/rollup/export), are latent. `★ Mark for eval` is a no-op stub.
- **Trees MCP danger tools are half-wired**: agent/terminal-backed tools throw unless a host injects their capability handlers; only `ensureWorktree` is injected by `trees mcp`.
- **No keyboard shortcuts anywhere**, in any of the three UIs. All interaction is pointer/native-form.
- **Search exists only in Usage** (one client-side gallery filter). Trees and Eval have no free-text search — they filter by selection and use fixed server-side sort.
- **Trees is not in the combined shell** — it runs on its own `trees-server`, unlike Usage/Eval which register as embedded apps. The app switcher won't list it.

---

*Generated from source. Key files: `src/cli/{index,product,ui-discovery}.ts`, `ui-server/src/index.ts`, `tangent-ui/src/App.svelte`; per surface: `{usage,trees-cli,eval}/src/cli/spec.ts`, `{usage,trees-server,eval}/src/server/index.ts`, `{usage-ui,trees-ui,eval-ui}/src/App.svelte`, `trees-mcp/src/index.ts`.*
