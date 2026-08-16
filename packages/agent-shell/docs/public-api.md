# @tangent/agent-shell Public API

Public import paths:

- `@tangent/agent-shell`
- `@tangent/agent-shell/cli`

Both export the same surface: `runAreaCli`, `runGoalCli`, `runIdeaCli`, `runAgentCli`, `runVaultCli`, and their help specs `areaCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `agentCommandSpec`, `vaultCommandSpec`. The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `goal`, `idea`, `agent`, and `vault` nouns, the same way `usage`/`eval`/`rollup`/`search`/`threads` are loaded. Nothing else is exported; the Reviewed build engine was removed in ADR-0023.

## Vault CLI

- `tangent area list|show <area>`: lists or shows one Area's Purpose/Resources, own Goals, and ideas.
- `tangent goal create --area <area> --title <t> --done-when <c> [--description <d>] [--source <file>]... [--subgoal-title <t> --subgoal-done-when <c>]... [--own [--session <name>]]`: creates a Goal, optionally with Subgoals. `--own` makes the calling agent's tmux session the Goal's owner in the same step (the trivial-task fast path).
- `tangent goal list [<area>]`, `tangent goal show <slug>`: list or show Goals.
- `tangent goal own <slug...>`, `tangent goal release <slug...>` `[--session <name>]`: take or hand back ownership. Ownership is the Goal's existing `session:` binding (status flips to `active`/`open` with it), so the desk display and the dead-session reconcile pass need no extra machinery. Owning never steals from another live session; the server refuses and names the owner. The session defaults to the tmux session the command runs in.
- `tangent goal done <slug>`, `tangent goal wont-do <slug> --reason <text>`: flip a Goal's status. Run only on the user's explicit word; idempotent when already in the target status.
- `tangent idea add <area> <text...>`, `tangent idea list [<area>]`: capture and list Area ideas.
- `tangent vault commit <paths...> -m "<verb>: <area> <summary>" [--area <path>]`: the one command in this surface that talks to git directly instead of the server. Verb is one of `add`, `note`, `update`, `remove`. Commits exactly the given vault-relative paths (pathspec, never staged) with `Tangent-Area`/`Tangent-Tmux` trailers, mirroring the server's own `vaultCommit()`.

## Agent messaging CLI

- `tangent agent list`: lists live agent sessions with their refined states (`working`, `needs decision`, `idle`, `draft`, `shell`) and queued message counts.
- `tangent agent send <name> <text...> [--from <session>]`: sends a message to another agent through the server's queue. The server stamps the sender banner and delivers only into an empty composer; otherwise the message queues. `--from` defaults to the tmux session the command runs in.

## Pipeline CLI

A pipeline is a list of steps on one Goal. The server owns it (one record per Goal under `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `agent-pipeline.v1`) and runs each step as an ordinary tmux Goal session. This package only posts to the endpoints below.

- `tangent goal start <slug> [--server] [--json]`: starts one agent on the Goal, the same as the desk's Start agent (`POST /api/goals/start { file, approved: true, launch: true }`).
- `tangent goal start <slug> --step <instruction> [--launch <harness[/model[/effort]]>] [--continue-from <n|->] ... [--server] [--json]`: starts a pipeline. `--step`, `--launch`, and `--continue-from` are repeatable and pair by position: the first `--launch` belongs to the first `--step`, and so on. A step without `--launch` uses the Area default harness. `--continue-from <n>` makes the step continue step n's live session instead of a fresh one; `-` means fresh. Posts `POST /api/goals/start { file, steps: [{ instruction, launch?, continueFrom }] }` and prints the step count and step 1's session name.
- `tangent goal append <slug> --step <instruction> [--launch <harness[/model[/effort]]>] [--continue-from <n|->] ... [--server] [--json]`: adds steps to the end of the Goal's pipeline, mid-run or finished, without restarting or losing what already ran. Same pairing rules as `start`; `--continue-from` may name any earlier step of the whole pipeline (the server checks the bound). Posts `POST /api/pipelines/append { goal, steps }` and prints what happened: the steps wait behind the running step, the finished last agent was asked to hand over again, or the first new step started.
- `tangent goal handover <facts...> [--session <name>] [--server]`: run by a step agent when its step is finished. Facts only: paths, what changed, what is unresolved, decisions Julian made. Posts `POST /api/goals/handover { session, text }`; the session defaults to the tmux session the command runs in. Prints `handed over; next: step N (<session>)` or `pipeline complete`. A session that is not a running pipeline step gets the server's 404 error text.

## Server contract

Every command but `vault commit` is a thin HTTP client to the running Agent Shell server (default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`, loopback-only). `--json` prints machine-readable output on read commands. Server-unreachable errors name the fix ("Agent Shell is not running..."); unknown Area/Goal errors suggest the nearest existing path or slug. Non-2xx responses surface the server's own `error` text.

Endpoints in `prototypes/agent-shell/server.mjs` used by this package:

- Read: `GET /api/tree`, `GET /api/areas/show?area=<path>`, `GET /api/goals[?area=<path>]`, `GET /api/goals/show?slug=<slug>`, `GET /api/ideas[?area=<path>]`, `GET /api/sessions`.
- Vault mutations: `POST /api/goals/create` (accepts `own: <session>`), `POST /api/idea/new`, `POST /api/goals/edit`, `POST /api/goals/own` and `POST /api/goals/release` (`{ session, slugs }`), `POST /api/agents/send`.
- `POST /api/goals/start`: `{ file, approved, launch, extraFiles? }` starts one agent; `{ file, steps: [{ instruction, launch?: { harness, model?, effort? }, continueFrom: n | null }], extraFiles? }` starts a pipeline and responds `{ session, pipeline: <record> }`. One endpoint for both, so there is one way to start work. Errors: 404 unknown Goal, 409 Goal done/dropped or owned by another live session or an unresolvable launch (names the harness/model/effort), 400 invalid steps.
- `POST /api/goals/handover`: `{ session, text }`. Marks the running step whose session matches as `complete` with `handover: text`, `handoverSource: "agent"`, then starts the next pending step. A step that already holds a handover (it was asked to hand over again after an append) keeps it and gains the new text below a blank line. Responds `{ status: "started", next: { index, session } }` or `{ status: "complete", next: null }`. 404 when the session is not a running step; 400 when the text is empty.
- `POST /api/pipelines/append`: `{ goal, steps: [{ instruction, launch?, command?, continueFrom }] }`. Appends pending steps after the existing ones (numbering and the 20-step cap continue from the record); nothing already run changes. Responds `{ status, after, next, session, added: [indices], pipeline }` where `status` is `"queued"` (a step is still running or stopped; the new steps wait behind it and the normal handover flows into them), `"asked"` (the pipeline was finished and the last step's session still runs an agent: that step is marked `running` again and a banner-less message asks it to run `tangent goal handover` again into step `added[0]`), or `"started"` (the pipeline was finished and the last agent is gone: the first new step started, `next: { index, session }`). Errors: 404 unknown Goal or no pipeline, 409 Goal done/dropped or an unresolvable launch, 400 invalid steps.

Endpoints the desk uses on the same records (not called by this package, listed so the record's lifecycle is in one place):

- `POST /api/pipelines/control`: `{ goal, action: "restart" | "skip" | "send", step }`. `restart` re-runs a stopped step in a new session (`...--s<N>-r<k>`); `skip` marks a step `skipped` with a skip handover and starts the next; `send` completes an idle step with the pane's last agent message as its handover and starts the next. Other combinations respond 409.
- `POST /api/pipelines/edit`: `{ goal, step, instruction?, choice?, command?, continueFrom? }` patches a `pending` step; 409 on any other status.
- `GET /api/sessions` gains `pipelines`: every record with its derived `status` (`running`, `paused`, `stopped`, `complete`), each step marked `live: boolean`, and the running step carrying the session's `state` and `stateDetail`.

Pipeline record shape (`agent-pipeline.v1`): `{ schema, goal, area, slug, createdAt, updatedAt, extraFiles, steps: [{ index, instruction, launch | null, command, label, continueFrom, status: "pending" | "running" | "complete" | "stopped" | "skipped", session, startedAt, endedAt, handover, handoverSource: "agent" | "skip" | "last-message" | null }] }`. Step sessions carry the tmux options `@tangent_pipeline` (the Goal file) and `@tangent_step` (the index).

See ADR-0020 for why the vault CLI lives here and ADR-0023 for pipelines.
