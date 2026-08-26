# @tangent/agent-shell Architecture

The published package API is `src/cli/`. The same package also carries the local Agent Shell application in `app/`. The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `brain`, `goal`, `idea`, `document`, `vault`, `agent`, `shell`, and `study` nouns, the same way it loads `usage`, `eval`, `rollup`, and `search`.

- `src/cli/spec.ts`: the help specs (`areaCommandSpec`, `brainCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `documentCommandSpec`, `agentCommandSpec`, `shellCommandSpec`, `studyCommandSpec`, `vaultCommandSpec`).
- `src/cli/client.ts`: the HTTP client. Loopback-only, default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`. Every request has a response deadline and operation ID. A mutation transport failure says that the effect can already have committed. The client reads a tmux session when one is available.
- `src/cli/commands/{area,goal,handover,brain,idea,document,agent}.ts`: thin HTTP clients to the Agent Shell server. Workers use one handover client and submit tagged reports. Brains can give an explicit caller session outside tmux. The server stores Goal queues and Request records. Goal mutations require the current live brain for the exact target Area.
- `src/cli/commands/shell.ts`: `tangent shell rebuild`. It posts the rebuild endpoint and polls `GET /api/sessions` until the boot id changes. `app/rebuild-operation.mjs` persists the target and lifecycle. `app/rebuild-worker.mjs` builds separately and stops the old server only after a successful build.
- `src/cli/commands/vault.ts`: the one command that shells out itself. `vault commit` uses `@tangent/repo`'s `git()` to commit directly to `~/.tangent/trees` with the same message shape and trailers as the server's `vaultCommit()`.
- `src/cli/commands/study.ts` and `study-contract.ts`: the second command that does not talk to the server. `tangent study` spawns a local interactive `claude` process with `stdio: "inherit"`, carrying the partner contract as an appended system prompt; the terminal belongs to that session until it exits (ADR-0026). No repo argument, no server involvement: scoping happens in the opening conversation, and the partner's own tool rights (read anywhere, edit and run only in a per-repo study worktree) come entirely from the contract text in `study-contract.ts`, not from code.

Dependencies: `@tangent/core` (arg parsing, help rendering), `@tangent/agent-runtime` (`runProcess` for `tmux display-message`), `@tangent/repo` (git for `vault commit`). The package does not import browser code, Eval, Usage, Rollup, Search, or Threads.

## Application boundaries

`app/gateway.mjs` is the stable public process edge. It alone owns port 4321, `/api/health`, static assets, SSE, and terminal WebSockets. It supervises `app/server.mjs` over IPC and an ephemeral loopback port. A controller heartbeat failure restarts only that controller; the gateway retains terminals and the last valid session snapshot (ADR-0032).

`app/public/refresh-lifecycle.js` serializes all complete browser projection reads. It keeps one trailing refresh when triggers overlap and owns projection retry timing. The browser probes gateway health only after a material projection error. Gateway and controller boot identities remain separate, so only a gateway replacement reloads browser assets.

`app/native/install-launch-agent.sh` installs the one outer gateway supervisor. Launchd restarts only unsuccessful exits and applies a ten-second throttle. The native app validates `/api/health`, asks launchd to start the job, and uses a re-probing exponential-backoff fallback only when the job is not installed.

`app/server.mjs` is the workflow-controller composition root. HTTP route modules parse transport input and map operation results. Stateful mechanisms live behind capability factories:

- `launch-catalog.mjs`: harness registry and Area launch resolution and writes;
- `message-delivery.mjs`: cross-agent queue order, delivery, audit, retargeting, and brain-notice settlement;
- `pane-observer.mjs`: tmux pane samples and derived agent state;
- `observation-cache.mjs`: coalesced session refresh and last-known-good fallback;
- `bounded-work.mjs`: ordered concurrency bounds for pane and message fan-out;
- `vault-repository.mjs`: safe atomic Markdown writes and exact-path provenance commits;
- record modules: the only readers and writers of Goal queues, brains, inboxes, requests, Operation events, armed prompts, and rebuild state. Compatibility readers normalize old pipeline and continuation records without writing those schemas.
- `area-brain-domain.mjs`: activation material, bounded Area memory, selected Document references, Journal intake, Goal queue transitions, Operation projection, and detached audit export.

The browser entry `app/public/shell.js` composes feature ports. `shell-coordinator.js` owns cross-feature navigation. Views and controllers receive cohesive `shell`, `work`, `areas`, `programs`, `launch`, `documents`, and chrome records. A record groups one authority; it is not a generic service locator. Browser capabilities must not be attached to functions. Gateway admission limits duplicate and total controller work. Telemetry does not publish projection invalidations.

Private module and controller-loopback contracts can change with all in-repository callers. The public loopback URL, Vault Markdown, Git provenance, tmux bindings, and persisted workflow schemas remain compatible. See ADR-0031 and ADR-0032.

The browser has one Area-based Work destination. Each exact Area has one logical brain identity. Its product lifecycle is active or inactive. Runtime attempts, health, waiting, and recovery do not change its visible author.

The vault owns Area knowledge. The bound product repository owns code-agent rules. Agent Shell derives both instruction stacks by path.
It does not ask an agent to select inherited facts. It does not copy complete repository instructions into every prompt.

Journal intake commits exact text before brain delivery. One active Journal rolls over at 256 KB.
One 8,000-character budget covers every character Agent Shell generates for a brain prompt. Only Julian's own founding instruction sits outside it. The checkpoint is generated text, so it sits inside and takes the room the structural sections left, down to a floor that keeps a replacement attempt oriented. Structural sections that cannot fit fail the brain start instead of starting a brain with no prompt. Each omitted collection or clipped section reports its source and count.

A brain mutates only its exact Area. A parent can read descendant milestones and route referenced text, but it cannot mutate child work. An approved Request authorizes only its hashed effect revision. Agent messages, handovers, notices, prompts, Documents, and inferred intent do not expand scope. Server mutation routes verify the current exact-Area brain attempt.

Uncovered work uses the stable durable-subject root. Descendant Areas and Goals appear as compact rows instead of peer cards.

Area Focus orders attention; it removes nothing. Work renders the primary focused Area expanded, the other focused Areas folded, and one folded `Other Areas` group that holds every Area outside the Focus.

A brain that is not live never wakes without Julian's words. The Work key opens the message box, and the send action starts a new brain from that message or wakes an inactive one with it. The message reaches the woken attempt as an unread notice. Only automatic recovery resumes with no message.

A separate Planned view keeps unstarted Goals available. Work carries no human-assignee concept. A planned review closes routine work when the done condition holds.
One `area-goal-queue.v2` record controls both one-assignment and multi-assignment work. Workers submit tagged reports. Only a designated typed review can close routine work, and only when its Goal revision and evidence match the current record. A done condition that needs Julian, a physical test, or an external authority uses a revision-bound Request effect.

Questions remain part of the native Area brain conversation. Every Question accepts free text. An optional allowlisted effect records durable intent before execution, runs once per revision, and stays actionable after failure.

Material Operation events use a durable exact-Area outbox. New or changed Problems, resolutions, and declared `report: true` results reach the brain. Routine healthy polling stays quiet.

The browser Programs projection also reads root-owned trigger state from `~/.tangent/agent-shell/triggers/state.json`. Trigger scheduling and launching remain in the root CLI so they work while this server is closed; the server delegates Check now, Acknowledge, and Stop controls back to `tangent trigger` (ADR-0030). Pause and Resume stay with the server, because the paused flag lives in the Area `.processes.json` manifest that the server already writes, and that file has no second writer to race with.

The Reviewed build engine that used to live here was deleted in ADR-0023; pipelines replaced it.
