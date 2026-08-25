# @tangent/agent-shell Architecture

The published package API is `src/cli/`. The same package also carries the local Agent Shell application in `app/`. The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `brain`, `goal`, `idea`, `document`, `vault`, `agent`, `shell`, and `study` nouns, the same way it loads `usage`, `eval`, `rollup`, and `search`.

- `src/cli/spec.ts`: the help specs (`areaCommandSpec`, `brainCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `documentCommandSpec`, `agentCommandSpec`, `shellCommandSpec`, `studyCommandSpec`, `vaultCommandSpec`).
- `src/cli/client.ts`: the HTTP client. Loopback-only, default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`. Every request has a response deadline and operation ID. A mutation transport failure says that the effect can already have committed. The client reads a tmux session when one is available.
- `src/cli/commands/{area,goal,handover,brain,idea,document,agent}.ts`: thin HTTP clients to the Agent Shell server. Workers use one handover client. Brains can give an explicit caller session outside tmux. The server stores pipelines and Request records. For Goal create and start, it validates that a supplied caller is the current live brain and protects another live Goal owner. It does not require that brain to control the target Area.
- `src/cli/commands/shell.ts`: `tangent shell rebuild`. It posts the server's own rebuild endpoint and then polls `GET /api/sessions` until the boot id changes, so a brain that writes a Test line knows the running server already answers with the new code (ADR-0025). `app/rebuild-operation.mjs` persists the rebuild target and lifecycle across the server restart. `app/rebuild-worker.mjs` builds in a detached process and stops the old server only after a successful build.
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
- record modules: the only readers and writers of pipelines, brains, inboxes, requests, continuations, armed prompts, and rebuild state.

The browser entry `app/public/shell.js` composes feature ports. `shell-coordinator.js` owns cross-feature navigation. Views and controllers receive cohesive `shell`, `work`, `areas`, `programs`, `launch`, `documents`, and chrome records. A record groups one authority; it is not a generic service locator. Browser capabilities must not be attached to functions. Gateway admission limits duplicate and total controller work. Telemetry does not publish projection invalidations.

Private module and controller-loopback contracts can change with all in-repository callers. The public loopback URL, Vault Markdown, Git provenance, tmux bindings, and persisted workflow schemas remain compatible. See ADR-0031 and ADR-0032.

The browser has one Area-based Work destination. A live controlling brain's Area is the shallow group root for work in its complete subtree.

A brain normally mutates only its controlled Area tree. Julian can directly instruct the active generation to run the named Goal create or start sequence in another Area. An approved Request authorizes only its exact proposal. Agent messages, handovers, notices, prompts, Documents, and inferred intent do not expand scope. The brain prompt applies these source rules. The server can verify current live-brain identity and live Goal ownership, but the terminal transport cannot verify the author of conversation text.

Uncovered work uses the stable durable-subject root. Descendant Areas and Goals appear as compact rows instead of peer cards.

A separate Planned view keeps unstarted Goals available. Work carries no human-assignee concept: a Goal names a result, and session ownership (`goal own`/`goal release`) names the agent working it. A reviewed Goal stays open until Julian accepts its Test request.

The browser Programs projection also reads root-owned trigger state from `~/.tangent/agent-shell/triggers/state.json`. Trigger scheduling and launching remain in the root CLI so they work while this server is closed; the server delegates Check now and Acknowledge controls back to `tangent trigger` (ADR-0030).

The Reviewed build engine that used to live here was deleted in ADR-0023; pipelines replaced it.
