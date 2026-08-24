# @tangent/agent-shell Public API

Public import paths:

- `@tangent/agent-shell`
- `@tangent/agent-shell/cli`

Both export the same surface: `runAreaCli`, `runBrainCli`, `runGoalCli`, `runIdeaCli`, `runDocumentCli`, `runAgentCli`, `runShellCli`, `runStudyCli`, `runVaultCli`, and their help specs `areaCommandSpec`, `brainCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `documentCommandSpec`, `agentCommandSpec`, `shellCommandSpec`, `studyCommandSpec`, `vaultCommandSpec`, plus `STUDY_CONTRACT` and `STUDY_CONTRACT_VERSION` (the partner's system prompt and its version). The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `brain`, `goal`, `idea`, `document`, `agent`, `shell`, `study`, and `vault` nouns, the same way `usage`/`eval`/`rollup`/`search` are loaded. Nothing else is exported; the Reviewed build engine was removed in ADR-0023.

The root package, not this package's import surface, owns `tangent trigger list|check|acknowledge|install`. Agent Shell reads its durable state for Programs and delegates manual controls to that CLI (ADR-0030).

## Vault CLI

- `tangent area list|show <area>`: lists or shows one Area's Purpose/Resources, own Goals, and ideas.
- `tangent area create <parent> <name>`: creates a nested Area with its note through the desk's `POST /api/areas/new`, committed with provenance. For a durable subject only; a result is a Goal.
- `tangent goal create --area <area> --title <t> --done-when <c> [--assignee <name>]... [--description <d>] [--source <file>]... [--subgoal-title <t> --subgoal-done-when <c>]... [--own [--session <name>]]`: creates a Goal, optionally with Subgoals. Each assignee must exist in the nearest Area roster. `--own` remains the separate agent-session operation.
- `tangent goal list [<area>]`, `tangent goal show <slug>`: list or show Goals.
- `tangent goal depend <slug> --on <prerequisite>...`, `tangent goal undepend <slug> --on <prerequisite>...`: add or remove idempotent prerequisite links. The server rejects missing, ambiguous, self, and cyclic dependencies. Dependencies are advisory and do not block or reorder Goal operations.
- `tangent goal own <slug...>`, `tangent goal release <slug...>` `[--session <name>]`: take or hand back ownership. Ownership is the Goal's existing `session:` binding (status flips to `active`/`open` with it), so the desk display and the dead-session reconcile pass need no extra machinery. Owning never steals from another live session; the server refuses and names the owner. The session defaults to the tmux session the command runs in.
- `tangent goal done <slug>`, `tangent goal wont-do <slug> --reason <text>`: flip a Goal's status. Run only on the user's explicit word; idempotent when already in the target status.
- `tangent idea add <area> <text...>`, `tangent idea list [<area>]`: capture and list Area ideas.
- `tangent document comments <file>`, `tangent document resolve <file> "<first words>" -m "<what changed>"`: list Julian's comments (CriticMarkup `{>>Julian: ...<<}` inside the Markdown) in one vault Document, and remove exactly one in its own `resolve:` commit. Resolve is the only agent path that removes a comment (design contract: otto/tangent/design-comment-on-documents).
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
- `tangent handover <facts...> [--session <name>] [--server]`: the worker's one managed-work operation. It reports facts to the controlling brain. A brain-controlled pipeline does not advance. Legacy continuation commands remain during migration.
- `tangent brain request --kind <plan|decision|test|approval> ...`: creates a durable request for Julian. Plan approval gates agent-originated Goal creation and worker launch.
- `tangent brain advance <goal> <step>`: starts one pending approved assignment after the brain reads the prior handover.

## Brain CLI

An Area brain is one long-lived orchestrating agent per Area (ADR-0024; design contract `otto/tangent/impl-area-brain`). The server owns its record (`~/.tangent/agent-shell/brains/<area>/brain.json`, schema `area-brain.v1`), its session, the event messages it hears, and its self-handover. Julian starts it from the brain icon on the Area card. This package only posts to the endpoints below.

- `tangent brain handover <facts...> [--session <name>] [--server]`: run by the brain when its context fills. Posts `POST /api/brains/handover { session, text }`; the server records the facts on the current generation, starts the next generation on a new session with the same instruction, the plan path, and these facts, then ends the calling session. Prints the new generation and session. A session that is not a running brain gets the server's 404 error text.
- `tangent brain status [<area>] [--session <name>] [--server] [--json]`: shows one brain (status, generation, session, plan file, instruction, latest handover) by Area, or by the tmux session the command runs in, then `Tangent shows N items for Julian`, one numbered line per row (each marked when Tangent hides it), and every section line that became no row. `GET /api/brains/show?area=|session=`.

## What waits on Julian

Under a brain, durable request records are the source of new plan, decision, test, and approval asks (ADR-0029). Existing `## For Julian` plan rows remain readable for active legacy runs during migration:

- `- Decide [[<document>]]: <the question, ending with ?> Unblocks: <what the answer unblocks>.`
- `- Decide: <one question that fits no Document, ending with ?>`
- `- Test [[<goal-slug>]]: <where to go, what to press, what he sees>.`

A Decide ask must end with a question mark or the line does not parse. Tangent puts the fixed question `Accept it?` under every Test row. A Test stays visible while its reviewed Goal is `open` or `done`. Accept marks an open Goal done and removes the Test. Reject removes the Test and keeps the Goal open. `Decision`, `Try it`, and `Brain` still parse as aliases of Decide (with a target), Test, and Decide (without one). Every line of the section that becomes no row is reported by `unparsedForJulianLines`, printed by `tangent brain status`, and sent to the brain once per plan change.

- `tangent shell rebuild [--server <url>] [--timeout <seconds>]`: prints the commits between the running server's deployed revision and repository `HEAD`, posts `POST /api/shell/rebuild`, then polls `GET /api/sessions` every 500 ms until `boot` changes. The rebuild has one durable operation record at `~/.tangent/agent-shell-rebuild.json`. The record captures the target commit and reports `building`, `restarting`, `reconnecting`, `succeeded`, or `failed`. A build error leaves the current server running. Default timeout 240 s; the failure names the rebuild log. The brain runs it before it writes a Test line. Uncommitted filesystem edits do not advertise an update.

## Study CLI

`tangent study` starts the study partner: an interactive agent session beside nvim that explores real code with Julian and gets him to change it (design contract: otto/tangent/design-code-first-study-partner). No repo argument; scoping happens in the opening conversation.

- `tangent study`: spawns `claude --verbose --dangerously-skip-permissions --append-system-prompt <STUDY_CONTRACT>` with `CLAUDE_CONFIG_DIR` set to `~/.claude-otto`, `stdio: "inherit"`. The session owns the terminal until it exits.
- `tangent study contract`: prints `STUDY_CONTRACT` to stdout and exits; no session is spawned.

## Server contract

Every command but `vault commit` and `study` is a thin HTTP client to the running Agent Shell server (default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`, loopback-only). `vault commit` writes the vault's git history directly; `study` spawns a local interactive session directly. `--json` prints machine-readable output on read commands. Server-unreachable errors name the fix ("Agent Shell is not running..."); unknown Area/Goal errors suggest the nearest existing path or slug. Non-2xx responses surface the server's own `error` text.

Endpoints in `packages/agent-shell/app/server.mjs` used by this package:

- Read: `GET /api/tree`, `GET /api/areas/show?area=<path>`, `GET /api/goals[?area=<path>]`, `GET /api/goals/show?slug=<slug>`, `GET /api/ideas[?area=<path>]`, `GET /api/document/comments?file=<path>`, `GET /api/sessions`. The sessions snapshot includes `deployedCommit`, `currentCommit`, `pendingCommits`, and the last `rebuild` operation. The blue update indicator appears only when the pending commit list is non-empty.
- `POST /api/shell/rebuild` starts one rebuild and returns its operation. A concurrent request returns 409.
- Vault mutations: `POST /api/goals/create` accepts `assignees: string[]` and the separate `own: <session>` value. `POST /api/goals/assignees` replaces the complete human assignee set.
- `POST /api/areas/people` replaces one Area's `## People` roster. The server rejects duplicate names, unknown assignees, and removal that can orphan an inherited Goal assignment.
- Other mutations include `POST /api/goals/depend`, `POST /api/goals/undepend`, `POST /api/idea/new`, `POST /api/goals/own`, `POST /api/goals/release`, and `POST /api/agents/send`.

The vault projection gives each Area `rosterArea` and `roster`. Each Goal has `assignees`, `assigneeKeys`, `rosterArea`, and `unassigned`.

A person key combines the defining Area path and a normalized name. Assignment routes do not call ownership, launch, pipeline, session, tmux, or status operations.
- `POST /api/goals/start`: `{ file, approved, launch, extraFiles? }` starts one agent; `{ file, steps: [{ instruction, launch?: { harness, model?, effort? }, continueFrom: n | null }], extraFiles? }` starts a pipeline and responds `{ session, pipeline: <record> }`. One endpoint for both, so there is one way to start work. Errors: 404 unknown Goal, 409 Goal done/dropped or owned by another live session or an unresolvable launch (names the harness/model/effort), 400 invalid steps.
- `POST /api/goals/handover`: `{ session, text }`. Marks the running step whose session matches as `complete` with `handover: text`, `handoverSource: "agent"`, then starts the next pending step. A step that already holds a handover (it was asked to hand over again after an append) keeps it and gains the new text below a blank line. Responds `{ status: "started", next: { index, session } }` or `{ status: "complete", next: null }`. 404 when the session is not a running step; 400 when the text is empty.
- `POST /api/pipelines/append`: `{ goal, steps: [{ instruction, launch?, command?, continueFrom }] }`. Appends pending steps after the existing ones (numbering and the 20-step cap continue from the record); nothing already run changes. Responds `{ status, after, next, session, added: [indices], pipeline }` where `status` is `"queued"` (a step is still running or stopped; the new steps wait behind it and the normal handover flows into them), `"asked"` (the pipeline was finished and the last step's session still runs an agent: that step is marked `running` again and a banner-less message asks it to run `tangent goal handover` again into step `added[0]`), or `"started"` (the pipeline was finished and the last agent is gone: the first new step started, `next: { index, session }`). Errors: 404 unknown Goal or no pipeline, 409 Goal done/dropped or an unresolvable launch, 400 invalid steps.

Endpoints the desk uses on the same records (not called by this package, listed so the record's lifecycle is in one place):

- `POST /api/pipelines/control`: `{ goal, action: "restart" | "skip" | "send", step }`. `restart` re-runs a stopped step in a new session (`...--s<N>-r<k>`); `skip` marks a step `skipped` with a skip handover and starts the next; `send` completes an idle step with the pane's last agent message as its handover and starts the next. Other combinations respond 409.
- `POST /api/pipelines/edit`: `{ goal, step, instruction?, choice?, command?, continueFrom? }` patches a `pending` step; 409 on any other status.
- `GET /api/sessions` gains `pipelines`: every record with its derived `status` (`running`, `paused`, `stopped`, `complete`), each step marked `live: boolean`, and the running step carrying the session's `state` and `stateDetail`.

Pipeline record shape (`agent-pipeline.v1`): `{ schema, goal, area, slug, createdAt, updatedAt, extraFiles, steps: [{ index, instruction, launch | null, command, label, continueFrom, status: "pending" | "running" | "complete" | "stopped" | "skipped", session, startedAt, endedAt, handover, handoverSource: "agent" | "skip" | "last-message" | null, continuations?, contextReminders? }] }`. Step sessions carry the tmux options `@tangent_pipeline` (the Goal file) and `@tangent_step` (the index).

Worker context continuation (ADR-0028; design contract `otto/tangent/design-worker-context-handover`): every worker session's fill is read from its own harness status bar, no extra tmux call. `GET /api/sessions` gains `contextHandoverTokens` (the constant, default 300000) at the top level, and each session and each pipeline step gains `context: { usedTokens, windowTokens } | null`. At the threshold, Tangent queues one reminder into the worker's own composer naming the exact `tangent goal handover --continue` command; a stronger repeat follows a tenth past it. Each level fires at most once per session. A step's `continuations` is `[{ session, next, facts, at, fill, failed? }]`, appended by every `--continue` swap; `contextReminders` is `{ [sessionName]: { firstAt, repeatAt } }`. A solo Goal session keeps the same two fields in its own small record, `goal-continuation.v1`, one file per Goal under `~/.tangent/agent-shell/continuations/<area>/<slug>.json` (`TANGENT_CONTINUATIONS_ROOT` to override the root).

Brain endpoints:

- `POST /api/brains/start`: `{ area, instruction, choice?, command?, resume? }`. Starts the Area's brain. An explicit run choice wins; otherwise the nearest `defaults.brain` declaration in the Area ancestry wins, followed by Claude · Fable 5 and the general Area launch fallback. It reattaches when one runs (`reattached: true`), or with `resume: true` starts a new generation of a stopped or ended brain from its record. Responds `{ session, generation, brain }`. 400 empty instruction, 404 unknown Area, 409 unresolvable launch.
- `POST /api/brains/handover`: `{ session, text }` as above. Responds `{ status: "started", session, generation, previous }`.
- `GET /api/brains/show?area=<path>` or `?session=<name>`: `{ brain }` with `live`, `state`, `stateDetail`, `stateQuestion`, `latestHandover`, `forJulian`, `forJulianUnparsed`; 404 when none.
- `GET /api/sessions` gains `brains`: every record with `live`, `state`, `stateDetail`, `stateQuestion`, `idleSince`, `latestHandover`, and `forJulian`. Brain sessions carry `kind: "brain"`, `brain` (the Area), and `generation`.
- `GET /api/launch/options?area=<path>&kind=brain` returns the harness, model, and effort choices with the resolved brain default. `POST /api/launch/default` accepts `kind: "brain"` to write that Area's explicit brain default without changing its general work default. Browse Areas exposes this editor under Area settings. Descendants inherit the nearest ancestor declaration and a more specific declaration wins.
- `forJulian` is the parsed `## For Julian` section, resolved against the vault index: `[{ kind: "decide" | "test", target, text, unblocks, line, index, file, title, commentCount, missing, goalStatus }]`. `target` is null for a Decide that names no Document. `line` is the exact plan line and the key a verdict press sends back.
- `forJulianUnparsed` (on `GET /api/brains/show` only) is every line of the section that became no row, as written.
- `POST /api/brains/verdict`: `{ area, line, verdict: "accept" | "reject" }`. Removes the line, commits the plan, and tells the brain `Julian accepted <target>` or `Julian rejected <target>`. Responds `{ ok: true, line, removedText, index, target, verdict }`; 400 on an unknown verdict or a targetless Decide, 404 when no brain covers the Area or the plan has no such line. A bare Reject means the brain parks the subject and does not raise it again.
- `POST /api/brains/verdict/undo`: `{ area, line, index }`. Puts the line back at that position, commits, and tells the brain `Julian withdrew his verdict on <target>; the line is back`. Responds `{ ok: true }`.
- A save through `POST /api/document` that adds or changes a comment in a Document a brain lists on a Decide row sends that brain one notice through the brain inbox. A removal sends nothing.
- `POST /api/kill/<name>` also ends the brain whose current session that is (`brainEnded: true`).

Brain record shape (`area-brain.v1`): `{ schema, area, instruction, launch | null, command, label, planFile, status: "running" | "stopped" | "ended", generation, session, createdAt, updatedAt, forJulianNoticeHash?, generations: [{ generation, session, startedAt, endedAt, handover, remindedAt }] }`.

See ADR-0020 for why the vault CLI lives here, ADR-0023 for pipelines, ADR-0024 for the Area brain, ADR-0025 for what waits on Julian under one, and ADR-0028 for worker context continuation.
