# @tangent/agent-shell Public API

Public import paths:

- `@tangent/agent-shell`
- `@tangent/agent-shell/cli`

Both export the same surface: `runAreaCli`, `runBrainCli`, `runGoalCli`, `runIdeaCli`, `runDocumentCli`, `runAgentCli`, `runShellCli`, `runStudyCli`, `runVaultCli`, and their help specs `areaCommandSpec`, `brainCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `documentCommandSpec`, `agentCommandSpec`, `shellCommandSpec`, `studyCommandSpec`, `vaultCommandSpec`, plus `STUDY_CONTRACT` and `STUDY_CONTRACT_VERSION` (the partner's system prompt and its version). The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `brain`, `goal`, `idea`, `document`, `agent`, `shell`, `study`, and `vault` nouns, the same way `usage`/`eval`/`rollup`/`search` are loaded. Nothing else is exported; the Reviewed build engine was removed in ADR-0023.

The root package, not this package's import surface, owns `tangent trigger list|check|acknowledge|install`. Agent Shell reads its durable state for Programs and delegates manual controls to that CLI (ADR-0030).

## Vault CLI

- `tangent area list|show <area>`: lists or shows one Area's Purpose/Resources, own Goals, and ideas.
- `tangent area create <parent> <name>`: creates a nested Area with its note through the desk's `POST /api/areas/new`, committed with provenance. For a durable subject only; a result is a Goal.
- `tangent goal create --area <area> --title <t> --done-when <c> [--description <d>] [--source <file>]... [--subgoal-title <t> --subgoal-done-when <c>]... [--own] [--session <name>]`: creates a Goal, optionally with Subgoals. `--session` supplies optional caller information and supplies the owner with `--own`. Tmux discovery remains a convenience. A supplied caller must be the current live brain, but it need not control the target Area. The brain may cross Areas only for Julian's direct instruction or an exact approved Request. Live-owner conflicts still fail.
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

- `tangent goal start <slug> [--session <name>] [--server] [--json]`: starts one agent on the Goal, the same as the desk's Start agent. `--session` supplies optional caller information outside tmux. A supplied caller must be the current live brain. Julian can authorize that brain to start named work in another Area; a different live Goal owner still blocks the start.
- `tangent goal start <slug> --step <instruction> [--launch <harness[/model[/effort]]>] [--path <directory>] [--continue-from <n|->] ... [--session <name>] [--server] [--json]`: starts a pipeline. `--step`, `--launch`, `--path`, and `--continue-from` are repeatable and pair by position. A step without `--launch` uses the Area default harness. `--path` gives one step any working directory on the machine; the CLI expands `~` and resolves a relative directory against the caller's shell, so the server always receives an absolute one. A step without `--path`, or with an empty `--path=` that skips a position, uses the Area repository, unchanged. `--continue-from <n>` continues step n's live session. `-` means a fresh session. The command posts the steps and optional caller to `POST /api/goals/start`.
- `tangent goal append <slug> --step <instruction> [--launch <harness[/model[/effort]]>] [--path <directory>] [--continue-from <n|->] ... [--server] [--json]`: adds steps to the end of the Goal's pipeline, mid-run or finished, without restarting or losing what already ran. Same pairing rules as `start`; `--continue-from` may name any earlier step of the whole pipeline (the server checks the bound). Posts `POST /api/pipelines/append { goal, steps }` and prints what happened: the steps wait behind the running step, the finished last agent was asked to hand over again, or the first new step started.
- `tangent goal handover <facts...> [--session <name>] [--server]`: run by a step agent when its step is finished. Facts only: paths, what changed, what is unresolved, decisions Julian made. Posts `POST /api/goals/handover { session, text }`; the session defaults to the tmux session the command runs in. Prints `handed over; next: step N (<session>)` or `pipeline complete`. A session that is not a running pipeline step gets the server's 404 error text.
- `tangent handover <facts...> [--session <name>] [--server]`: the worker's one managed-work operation. It reports facts to the controlling brain. A brain-controlled pipeline does not advance. Legacy continuation commands remain during migration.
- `tangent brain request --kind <plan|decision|test|approval> ...`: creates a durable request for Julian. Each answer applies to that Request's proposal. Direct instructions in the active brain conversation also authorize work.
- `tangent brain advance <goal> <step>`: starts one pending approved assignment after the brain reads the prior handover.

## Brain CLI

An Area brain is one long-lived orchestrating agent per exact Area (ADR-0024; design contract `otto/tangent/impl-area-brain`). The server owns its record, session, event messages, and self-handover. The record uses `~/.tangent/agent-shell/brains/<area>/brain.json` and schema `area-brain.v1`. Work uses the nearest live brain: the exact Area first, then its ancestors. A live child brain owns its subtree until it stops. Julian can open, resume, or start an exact sub-Area brain from its Work header. This package only posts to the endpoints below.

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

Every command but `vault commit` and `study` is a thin HTTP client to the running Agent Shell gateway (default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`, loopback-only). `vault commit` writes the vault's git history directly; `study` spawns a local interactive session directly. `--json` prints machine-readable output on read commands. Requests have a 20-second default response deadline and carry an operation ID. Gateway-unreachable errors name the fix ("Agent Shell is not running..."). A mutation that loses its response says that it may have committed and tells the caller to inspect state before retrying. Unknown Area/Goal errors suggest the nearest existing path or slug. Non-2xx responses surface the controller's own `error` text.

Public endpoints enter through `packages/agent-shell/app/gateway.mjs` and are handled by the controller routes composed in `server.mjs`:

- Read: `GET /api/tree`, `GET /api/areas/show?area=<path>`, `GET /api/goals[?area=<path>]`, `GET /api/goals/show?slug=<slug>`, `GET /api/ideas[?area=<path>]`, `GET /api/document/comments?file=<path>`, `GET /api/sessions`. The sessions snapshot includes `deployedCommit`, `currentCommit`, `pendingCommits`, and the last `rebuild` operation. The blue update indicator appears only when the pending commit list is non-empty.
- `POST /api/shell/rebuild` starts one rebuild and returns its operation. A concurrent request returns 409.
- Vault mutations: `POST /api/goals/create` accepts optional `caller` information and the separate `own: <session>` value.
- Other mutations include `POST /api/goals/depend`, `POST /api/goals/undepend`, `POST /api/idea/new`, `POST /api/goals/own`, `POST /api/goals/release`, and `POST /api/agents/send`.

The vault projection carries no human-assignee fields. A Goal file written before the removal can still hold an `assignees:` frontmatter line; the server ignores it and preserves it on edit.
- `POST /api/goals/start`: `{ file, approved, launch, caller?, extraFiles? }` starts one agent. `{ file, steps, caller?, extraFiles? }` starts a pipeline. The server copies the current Work default into each step that has no launch. Thus, later Area edits do not change pending steps. A supplied caller must be a current live brain; it does not have to control the target Area. The brain prompt limits cross-Area use to Julian's direct instruction or an exact approved Request. The server does not require a plan Request. Errors include an unknown Goal, an invalid caller, and ownership by another live session.
- `POST /api/goals/handover`: `{ session, text }`. Marks the running step whose session matches as `complete` with `handover: text`, `handoverSource: "agent"`, then starts the next pending step. A step that already holds a handover (it was asked to hand over again after an append) keeps it and gains the new text below a blank line. Responds `{ status: "started", next: { index, session } }` or `{ status: "complete", next: null }`. 404 when the session is not a running step; 400 when the text is empty.
- `POST /api/pipelines/append`: `{ goal, steps: [{ instruction, launch?, command?, path?, continueFrom }] }`. A step's `path` must be an absolute existing directory; the server proves every step's directory before it writes the record or starts tmux, so a bad one answers 400 (`step N: no directory <dir>` or `step N: path <dir> is not an absolute directory`) and leaves nothing behind. The server appends pending steps after the existing steps. It copies the current Work default into each appended step that has no launch. Existing steps do not change. The response is `{ status, after, next, session, added: [indices], pipeline }`. `status` is `"queued"`, `"asked"`, or `"started"`. Errors include an unknown Goal, no pipeline, a closed Goal, an invalid step, or an unresolved launch.

Endpoints the desk uses on the same records (not called by this package, listed so the record's lifecycle is in one place):

- `POST /api/pipelines/control`: `{ goal, action: "restart" | "skip" | "send", step }`. `restart` re-runs a stopped step in a new session (`...--s<N>-r<k>`); `skip` marks a step `skipped` with a skip handover and starts the next; `send` completes an idle step with the pane's last agent message as its handover and starts the next. Other combinations respond 409.
- `POST /api/pipelines/edit`: `{ goal, step, instruction?, choice?, command?, continueFrom? }` patches a `pending` step; 409 on any other status.
- `GET /api/sessions` gains `pipelines`: every record with its derived `status` (`running`, `paused`, `stopped`, `complete`), each step marked `live: boolean`, and the running step carrying the session's `state` and `stateDetail`.

Pipeline record shape (`agent-pipeline.v1`): `{ schema, goal, area, slug, createdAt, updatedAt, extraFiles, steps: [{ index, instruction, launch | null, command, label, path, continueFrom, status: "pending" | "running" | "complete" | "stopped" | "skipped", session, startedAt, endedAt, handover, handoverSource: "agent" | "skip" | "last-message" | null, continuations?, contextReminders? }] }`. `path` is the step's own working directory, or `null` for the Area repository. It is part of the record, so a restarted step and a `--continue` replacement session both open where the step was told to. A step that continues an earlier live session (`continueFrom`) inherits that session's directory and ignores its own `path`, the same way it ignores its own launch. Step sessions carry the tmux options `@tangent_pipeline` (the Goal file) and `@tangent_step` (the index).

Worker context continuation (ADR-0028; design contract `otto/tangent/design-worker-context-handover`): every worker session's fill is read from its own harness status bar, no extra tmux call. `GET /api/sessions` gains `contextHandoverTokens` (the constant, default 300000) at the top level, and each session and each pipeline step gains `context: { usedTokens, windowTokens } | null`. At the threshold, Tangent queues one reminder into the worker's own composer naming the exact `tangent goal handover --continue` command; a stronger repeat follows a tenth past it. Each level fires at most once per session. A step's `continuations` is `[{ session, next, facts, at, fill, failed? }]`, appended by every `--continue` swap; `contextReminders` is `{ [sessionName]: { firstAt, repeatAt } }`. A solo Goal session keeps the same two fields in its own small record, `goal-continuation.v1`, one file per Goal under `~/.tangent/agent-shell/continuations/<area>/<slug>.json` (`TANGENT_CONTINUATIONS_ROOT` to override the root).

Brain endpoints:

- `POST /api/brains/start`: `{ area, instruction, choice?, command?, resume? }`. Starts the Area's brain. An explicit run choice wins. Otherwise, the nearest Brain declaration wins. The value `"work"` uses the target Area's declared Work launch. Without a Brain declaration, the server uses the declared Work launch. The server returns 409 if neither declaration exists. It does not use the Work profile fallback. A live brain reattaches. A resume keeps the launch in the brain record. A start-over operation resolves the current default. The response is `{ session, generation, brain }`.
- `POST /api/brains/handover`: `{ session, text }` as above. Responds `{ status: "started", session, generation, previous }`.
- `GET /api/brains/show?area=<path>` or `?session=<name>`: `{ brain }` with `live`, `state`, `stateDetail`, `stateQuestion`, `latestHandover`, `forJulian`, `forJulianUnparsed`; 404 when none.
- `GET /api/sessions` gains `brains`: every record with `live`, `state`, `stateDetail`, `stateQuestion`, `idleSince`, `latestHandover`, and `forJulian`. Brain sessions carry `kind: "brain"`, `brain` (the Area), and `generation`.
- `GET /api/launch/options?area=<path>&kind=all` returns the catalog, both effective defaults, and both local declarations. Work and Brain inherit independently. The nearest declaration of the same kind wins.
- `POST /api/launch/default` accepts `{ area, kind, mode, launch? }`. `kind` is `"work"` or `"brain"`. `mode: "launch"` stores validated catalog identifiers. `mode: "inherit"` removes the selected local key. `mode: "work"` is valid only for Brain. It stores the explicit `"work"` policy. The Area settings view exposes this editor. It does not start an agent.
- `forJulian` is the parsed `## For Julian` section, resolved against the vault index: `[{ kind: "decide" | "test", target, text, unblocks, line, index, file, title, commentCount, missing, goalStatus }]`. `target` is null for a Decide that names no Document. `line` is the exact plan line and the key a verdict press sends back.
- `forJulianUnparsed` (on `GET /api/brains/show` only) is every line of the section that became no row, as written.
- `POST /api/brains/verdict`: `{ area, line, verdict: "accept" | "reject" }`. Removes the line, commits the plan, and tells the brain `Julian accepted <target>` or `Julian rejected <target>`. Responds `{ ok: true, line, removedText, index, target, verdict }`; 400 on an unknown verdict or a targetless Decide, 404 when no brain covers the Area or the plan has no such line. A bare Reject means the brain parks the subject and does not raise it again.
- `POST /api/brains/verdict/undo`: `{ area, line, index }`. Puts the line back at that position, commits, and tells the brain `Julian withdrew his verdict on <target>; the line is back`. Responds `{ ok: true }`.
- A save through `POST /api/document` that adds or changes a comment in a Document a brain lists on a Decide row sends that brain one notice through the brain inbox. A removal sends nothing.
- `POST /api/kill/<name>` also ends the brain whose current session that is (`brainEnded: true`).

Brain record shape (`area-brain.v1`): `{ schema, area, instruction, launch | null, command, label, planFile, status: "running" | "stopped" | "ended", generation, session, createdAt, updatedAt, forJulianNoticeHash?, generations: [{ generation, session, startedAt, endedAt, handover, remindedAt }] }`.

See ADR-0020 for why the vault CLI lives here, ADR-0023 for pipelines, ADR-0024 for the Area brain, ADR-0025 for what waits on Julian under one, and ADR-0028 for worker context continuation.
