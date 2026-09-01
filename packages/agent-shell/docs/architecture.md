# @tangent/agent-shell Architecture

The published package API is `src/cli/`. The same package also carries the local Agent Shell application in `app/`. The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for `area`, `brain`, `goal`, `job`, `document`, `vault`, `agent`, `shell`, and `study`.

- `src/cli/spec.ts`: the help specifications for each public Agent Shell command.
- `src/cli/client.ts`: the HTTP client. Loopback-only, default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`. Every request has a response deadline and operation ID. A mutation transport failure says that the effect can already have committed. The client reads a tmux session when one is available.
- `src/cli/commands/`: thin HTTP clients to the Agent Shell server. Goal owns intent, Job owns execution, Agent owns sessions, and Brain owns Area organization. Hidden compatibility aliases call the canonical service for one release.
- `src/cli/commands/shell.ts`: `tangent shell rebuild`. It posts the rebuild endpoint and polls `GET /api/sessions` until the boot id changes. `app/rebuild-operation.mjs` persists the target and lifecycle. `app/rebuild-worker.mjs` builds separately and stops the old server only after a successful build.
- `src/cli/commands/vault.ts`: the one command that shells out itself. `vault commit` uses `@tangent/repo`'s `git()` to commit directly to `~/.tangent/trees` with the same message shape and trailers as the server's `vaultCommit()`.
- `src/cli/commands/study.ts` and `study-contract.ts`: the second command that does not talk to the server. `tangent study` spawns a local interactive `claude` process with `stdio: "inherit"`, carrying the partner contract as an appended system prompt; the terminal belongs to that session until it exits (ADR-0026). No repo argument, no server involvement: scoping happens in the opening conversation, and the partner's own tool rights (read anywhere, edit and run only in a per-repo study worktree) come entirely from the contract text in `study-contract.ts`, not from code.

Dependencies: `@tangent/core`, `@tangent/agent-runtime`, and `@tangent/repo`. The Area-map browser island uses React and `@excalidraw/excalidraw`. The package does not import Eval, Usage, Rollup, or Search.

## Application boundaries

`app/gateway.mjs` is the stable public process edge. It alone owns port 4321, `/api/health`, static assets, SSE, terminal WebSockets, and the persisted Work store. It supervises `app/server.mjs` over IPC and an ephemeral loopback port. A controller heartbeat failure restarts only that controller. The gateway retains terminals, the diagnostic session snapshot, and the immutable Work buffer (ADR-0032, ADR-0056).

Gateway and controller share one stable Agent Shell instance identity. The gateway passes this identity to each replacement controller and verifies the ready message.

`app/session-ownership.mjs` owns tmux process authority. It sets `@tangent_agent_shell_instance` and stores a durable owner sidecar for each created session. It claims and terminates the immutable tmux session ID. Foreign sessions are never attached, terminated, or recovered. Markerless legacy sessions stay isolated, except an explicit resume can claim the exact brain whose durable identity matches its live brain tags (ADR-0036).

`app/public/refresh-lifecycle.js` serializes all conditional Work reads. It keeps one trailing refresh when triggers overlap and owns retry timing. SSE reconnect performs one read. A 30-second poll repairs lost events. The browser probes gateway health only after a material Work error. Gateway and controller boot identities remain separate, so only a gateway replacement reloads browser assets.

The browser refreshes through `GET /api/work` v3 only. The controller reads seven exact source classes and derives one bounded candidate. The gateway validates and atomically publishes it before it changes the public buffer. Work excludes reports, notices, prompts, Attempt history, generation history, Request bodies, document indexes, and complete Program rows. Targeted Job, Agent, Goal, Brain, Area, Process, navigation, shell-status, and prompt routes own that detail. Work has a content ETag. Transport headers can mark equal bytes stale, degraded, or current.

`app/native/install-launch-agent.sh` installs the one outer gateway supervisor. Launchd restarts only unsuccessful exits and applies a ten-second throttle. The native app validates `/api/health`, asks launchd to start the job, and uses a re-probing exponential-backoff fallback only when the job is not installed.

`app/server.mjs` is the workflow-controller composition root. HTTP route modules parse transport input and map operation results. Stateful mechanisms live behind capability factories:

- `launch-catalog.mjs`: harness registry, inherited Area launch policy, filtered choices, policy writes, and scoped legacy-harness aliases. An alias canonicalizes a stored launch reference before policy validation; it does not expose the source harness as a new choice;
- `launch-memory.mjs`: last successful Brain and Work launch per Area;
- `brain-launch.mjs`: per-attempt Brain default or registry-choice resolution, stale-choice checks, and immutable launch snapshots;
- `message-delivery.mjs`: cross-agent queue order, delivery, audit, retargeting, and brain-notice settlement;
- `message-queue-store.mjs`: atomic persistence for generic `tangent send` messages until pane-presentation settlement;
- `agent-context.mjs`: the read-only recovery projection from durable brain, Goal, and queue records, independent of harness screen recognition and session ownership;
- `agent-recovery.mjs`: stable recovery events derived from passive pane state, persisted by the controller through the brain inbox;
- `pane-observer.mjs`: tmux pane samples and derived agent state;
- `observation-cache.mjs`: coalesced session refresh and last-known-good fallback;
- `session-ownership.mjs`: runtime identity, live tmux ownership, stale ownership evidence, and guarded termination;
- `bounded-work.mjs`: ordered concurrency bounds for pane and message fan-out;
- `vault-repository.mjs`: safe atomic Markdown writes and exact-path provenance commits;
- record modules: the only readers and writers of `job.v1`, worker report receipts, Brains, inboxes, Requests, Operation events, armed exact-prompt receipts, and rebuild state. `job-record.mjs` preserves numbered run history and reads both old execution schemas; `pipeline-record.mjs` is a one-release re-export.
- `area-brain-domain.mjs`: milestone storage, Goal queue transitions, Operation projection, and detached audit export.
- `area-presentations.mjs`: Area-keyed runtime attention records. They project only to `area.presentations`, use the existing Document readers, and are removed when an Area is done or archived.

The browser entry `app/public/shell.js` composes feature ports. `shell-coordinator.js` owns cross-feature navigation. Views and controllers receive cohesive `shell`, `work`, `areas`, `programs`, `launch`, `documents`, and chrome records. A record groups one authority; it is not a generic service locator. Browser capabilities must not be attached to functions. Gateway admission limits duplicate and total controller work. Telemetry does not publish projection invalidations.

Area maps use one Excalidraw source shard for each Area. `area-map-world-index.mjs` combines the Area tree, shard summaries, and structural regions. One framework-neutral layout kernel resolves nested requirements and sibling reflow for both the server and browser. `area-map-world-controller.js` keeps one composed world across camera and fact changes. `area-map-transaction-repository.mjs` commits each multi-shard gesture through one durable transaction. Tangent block text remains a cache of vault facts (ADR-0049, ADR-0051, ADR-0052).

Private module and controller-loopback contracts can change with all in-repository callers. The public loopback URL, Vault Markdown, Git provenance, tmux bindings, and persisted workflow schemas remain compatible. The runtime ownership key remains `@tangent_agent_shell_instance`. See ADR-0031, ADR-0032, and ADR-0036.

The browser gives each key to one visible context. A blocking modal wins, then Go To, quick Document, terminal session, transient UI, staged Focus, text entry, and the current view. The terminal keeps every key except its visible `Command-J` leave action. Work and Document shortcuts cannot run behind it. See ADR-0038.

`Go to` opens a Document in the read-only quick layer above the current screen or session. The lower surface stays mounted. `Open full reader` is the one control that leaves the quick path.

The browser has one Area-based Work destination. Each exact Area has one logical brain identity. Its product lifecycle is active or inactive. Runtime attempts, health, waiting, and recovery do not change its visible author.

The vault owns Area knowledge. The bound product repository owns code-agent rules. Agent Shell derives both instruction stacks by path.
An Area binds its repository with `- Repository:`, `- Worktree:`, and `- Branch:` lines under `## Resources` in its note. `area-resources.mjs` is the one parser. Workers, programs, `tangent area show`, the brain prompt, and the root trigger runtime read Area folders through it. A worker starts in the nearest bound folder or is refused. A brain always starts in its Area folder inside the vault and reads the bound repository from its prompt.

A skill is `<area>/skill-<slug>.md`, a Document whose frontmatter has `name:` and `description:` (D20). `area-skills.mjs` parses it, lists every skill on the route from the vault root to an Area, and reads the bound repository's project skills from `.claude/skills` and `.agents/skills`. `tangent area show` prints them as `- <name>: <description> (<path>)`, and the Area page lists them under the Documents.
It does not ask an agent to select inherited facts. It does not copy complete repository instructions into every prompt.

Area messages use `POST /api/agents/send`. This route writes the Area inbox before it queues live delivery. Retries use one source identifier.
Agent Shell generates no brain prompt (ADR-0041). Each Area folder holds `AGENTS.md -> <dirname>.md` and `CLAUDE.md -> AGENTS.md`, and the vault root holds a real `AGENTS.md` that says how to be a brain. The brain opens in its Area folder and the harness reads that chain itself. The first message is Julian's own words, verbatim, with the notices that waited in the Area inbox below them, or `Start.` when there are none. `area-note-links.mjs` keeps the links and the template note; a sweep at server start and `tangent area create` write them, and never replace a real file.

Area paths organize records and message destinations; they do not grant command permission. Any local caller can mutate work in any Area through the same server routes. Caller session, caller Area when known, target Area, and operation identity are audit provenance. The target Area receives a durable inbox event after commit, even when its brain is inactive or missing. One Goal queue, expected revisions, idempotency, live ownership, exact attempts, and immutable tmux targets remain the conflict fences.

Uncovered work uses the stable durable-subject root. Descendant Areas and Goals appear as compact rows instead of peer cards.

Area Focus orders attention; it removes nothing. Work renders the primary focused Area expanded, the other focused Areas folded, and one folded `Other Areas` group that holds every Area outside the Focus.

A brain that is not live never wakes without Julian's words. The Work key opens the message box, and the send action starts a new brain from that message or wakes an inactive one with it. The message reaches the woken attempt as an unread notice. Only automatic recovery resumes with no message.

Each new brain attempt stores one complete `resolvedLaunch` snapshot on its generation. A user start or resume can select one registered harness, model, and effort for that attempt. The selection does not change the Area default. Reattachment keeps the live generation's launch, while automatic recovery resolves the current Area default. A brain never hands over to a copy of itself: it runs until the user restarts it, opens in its Area folder, and reads the Area note chain as its instruction, with the user's message typed verbatim as its first message (ADR-0041).

One canonical exact-Area lifecycle queue serializes brain start, automatic recovery, stop, and reconciliation. Each operation rereads the brain record after it enters that queue. Reconciliation freshly inspects a current attempt created after its tmux snapshot before it can consume a recovery attempt. A stop fences the expected attempt, persists `pending` before termination, and retries `pending` or `incomplete` after interruption. Resume refuses an unsettled stop. An already-absent attempt needs the current instance's durable sidecar before logical stop can complete. A stale recovery cannot resurrect the brain, and a live foreign or unmarked tmux session remains protected.

Work shows every open Goal in one projection. Runtime and readiness remain row facts. Work carries no human-assignee concept. A planned review closes routine work when the done condition holds.
Work also shows up to three Area-scoped Document presentations directly below the exact Area header. Area and Goal presentation stores stay separate so an Area presentation cannot enter Goal sources, relations, counts, or lifecycle.
One `area-goal-queue.v2` record controls both one-assignment and multi-assignment work. Each accepted worker handover adds one `worker-handover-receipt.v1` record to its assignment. The receipt links the worker, Goal, assignment, queue result, exact destination Area, and inbox notice. A receipt without a notice ID is a durable outbox item. Reconcile and exact retries use its stable source ID to produce one notice. A review is a step like any other (`--kind review` only labels it). No worker report closes a Goal: the brain reads the note and runs `tangent goal done`. A Goal Julian flagged `verify: yes` becomes `verify` (shown as Check it) on the brain's done, its session is cleared, and `julian-notify.mjs` sends his one notification; his own Done closes it (ADR-0041).

Workers use plain notes for facts they can act without, `--done` to finish, and `--blocked` only for a real dependency. A brain send to a worker always keeps ordinary message semantics.

Recovery is pull-based when terminal delivery fails. `GET /api/agents/context` rebuilds the current brain or worker prompt from durable records and returns current unread exact-Area brain notices. Worker recovery includes every Goal bound to the session. A Goal queue's ordered `extraFiles` remains authoritative when bindings later move. The rebuilt prompt repeats those co-assigned Goals in that order. The route does not require the session ownership marker and does not mutate workflow state. A read-only live-session check distinguishes an unassigned tmux shell from an unknown session. Reconcile records one source-ID-deduplicated brain notice when a bound running worker returns to its shell; it leaves the tmux session and queue assignment running for in-place harness recovery.

Generic cross-agent messages use `agent-message-queue.v1`. The controller stores an exact resolved session and normalized message before it wakes or writes to the pane. It restores pending records in first-in, first-out order after a restart. Pane presentation settles the record. This boundary does not claim that the model read the message. See ADR-0039.

Questions remain part of the native Area brain conversation. Every Question accepts free text. An optional allowlisted effect records durable intent before execution, runs once per revision, and stays actionable after failure.

Material Operation events use a durable exact-Area outbox. New or changed Problems, resolutions, and declared `report: true` results reach the brain. Routine healthy polling stays quiet.

Processes are notes (ADR-0043). `app/process-note.mjs` parses `<area>/process-<slug>.md` and computes schedule slots. `app/process-scheduler.mjs` runs as a 10 s lane of the runtime scheduler: it reads every process note, keeps run state in `~/.tangent/agent-shell/processes/<area>/<slug>.json`, and writes one note to the exact-Area brain inbox when a process is due. A loop note (`every:` alone) instead gets its body sent to a live brain every so often. It starts no worker. `GET /api/processes` supplies discovery. The create, remove, control, and check process routes serve `tangent process`. The server writes and commits loop notes. It also clears the exact derived state when it creates or removes a loop. The root `tangent trigger` runtime and its LaunchAgent are retired.

The Reviewed build engine that used to live here was deleted in ADR-0023; pipelines replaced it.
