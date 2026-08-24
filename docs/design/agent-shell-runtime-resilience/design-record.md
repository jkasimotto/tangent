# Agent Shell runtime resilience: design record

Date: 2026-08-24

## Problem contract

Agent Shell must keep live brain terminals usable when background control work
fails. It must also end managed tmux sessions when their work reaches a durable
natural completion. It must not destroy an unrelated shell or an ambiguous
session.

Observable success:

- Terminal input and output remain available while vault projection,
  reconciliation, or message delivery is slow or restarting.
- The app answers health and terminal attachment requests within a fixed
  deadline.
- A managed worker session disappears after its successful handover or
  authorized close flow.
- Restarting any Agent Shell process neither loses workflow state nor kills a
  live agent.
- Ambiguous sessions remain visible as orphaned and are not auto-deleted.
- Runtime status identifies the failed layer and the last valid snapshot.
- With 200 retained sessions, 50 observed agent panes, 25 attached terminals,
  and 100 queued messages, all fan-out remains bounded and one observation is
  shared by concurrent callers.
- A second launcher cannot compete for port 4321 or restart in a tight loop.
- A CLI mutation that loses its connection can discover whether it committed;
  it does not require an unsafe blind retry.

Non-goals:

- Replace tmux, vault Markdown, Git provenance, or provider-native transcripts.
- Split Agent Shell into another publishable package or a remote service.
- Make private loopback APIs compatible with external callers.
- Use completed tmux sessions as historical storage.

## Current system facts

### One event loop owns unrelated failure domains

`packages/agent-shell/app/server.mjs` creates one Node HTTP server. The same
process attaches `/term`, builds `/api/sessions`, scans tmux panes, constructs
the vault index, reconciles Goals, pipelines, brains, continuations, and runs
the message scheduler.

`packages/agent-shell/app/terminal-transport.mjs` attaches the terminal
WebSocket to that same HTTP server. Therefore event-loop starvation in any
application task also stops terminal frames.

`packages/agent-shell/app/runtime-scheduler.mjs` prevents task overlap, but it
runs every task in the server process. Its isolation is logical, not
operational. A synchronous CPU loop inside one awaited task blocks all routes.

### The live failure reproduced this coupling

On 2026-08-24, tmux pane capture showed normal Codex and Claude output in the
brain sessions. The UI showed black terminal panes. Agent Shell accepted TCP
connections on port 4321 but returned no HTTP bytes. Its Node process remained
near 101 percent CPU.

A macOS process sample placed the main thread inside
`String.prototype.replace`, regular-expression execution, string flattening,
allocation, and garbage collection. The JavaScript function was not
symbolized in that first sample. Later stage tracing identified the exact
session-name allocator loop described below.

Restarting Agent Shell produced one successful snapshot, then the same loop.
Disabling the always-active reconciliation task removed one trigger. Repeated
`/api/sessions` requests still triggered the CPU loop. Removing vault-wide
For-Julian enrichment from the polling snapshot reduced the coupled workload:
five requests completed in 0.03 to 0.38 seconds and CPU stayed near idle.
The complete For-Julian contract is restored in the replaceable, cached
controller snapshot.

These facts established that unrelated projection work amplified a controller
failure in the public process. They were diagnostic guards, not the final root
cause or acceptable feature removals.

### Completed sessions are preserved by policy

`reconcileGoals` explicitly says that its background pass never stops a tmux
session. For a session whose Goal is done or absent from the index, it logs
`preserved session ... only the user can stop it`.

`packages/agent-shell/app/session-safety.test.mjs` requires reconciliation to
contain no `kill-session`. This is an intentional policy, not a missed call.

`completePipelineStep` persists the handover and advances or notifies the
brain. It does not end the completed step's tmux session. A final pipeline step
therefore remains alive after its durable completion.

Context continuation and brain self-handover already contain a safer precedent:
the replacement is started first and the previous exact session is ended only
after the new prompt is confirmed or after the handover succeeds.

### Tests share the user's tmux server

Several HTTP fixture tests create real tmux sessions and clean them in test
teardown. The leaked names in the live server include test fixture prefixes and
plain zsh panes. A failed or interrupted teardown leaves fixtures in the user's
tmux namespace. Test isolation cannot rely only on successful cleanup.

### `brain advance` reproduced a complete visible failure

On 2026-08-24 at 19:14 AEST, the exact pending command
`tangent brain advance standards-architecture-names-shapes-and-ownershi 3`
was run twice under observation. Both calls blocked for about 20 seconds. The
event-loop watchdog then terminated the server, the CLI returned only `fetch
failed`, and the native app started a replacement. The durable pipeline still
showed step 3 as pending, so neither attempt partially committed.

Stage tracing stopped immediately after the live-session snapshot. A process
sample showed the main thread spending its time in string normalization and
`Set` lookup. The exact defect was the pipeline session-name collision loop:
it appended `-r2`, then truncated the complete string to 60 characters. For a
60-character occupied name, truncation removed the retry suffix, so every
iteration tested the same name forever. The same unbounded pattern also
existed in continuation naming.

The implementation now reserves suffix space before truncation and gives name
allocation a finite attempt budget. A regression fixture uses the exact long
step-3 collision. The previously pending command then completed in 1.34
seconds and kept the same server process alive.

The mutation path also performed work far outside the requested Goal:

- `controlPipeline` calls `goalsByFile`, which walks every Area and reads every
  Goal.
- `startPipelineStep` repeats that complete scan.
- `goalPrompt` repeats the scan for dependency prose and requests the complete
  vault Document projection for one Goal's sources.

A six-second sample of the public server during the failure spent its main
thread in regular-expression replacement, string flattening, lowercasing,
internalization, `Set` lookup, allocation, and garbage collection. Combined
with causal stage tracing, this identified name allocation as the incident
loop. The vault-wide scans were separate amplification risks and are removed
from this mutation path.

The HTTP tests inspected for this incident allocate random ports. A live test
server existed on another port during the reproduction and did not own 4321.
The claim that those tests caused the port collision was false. The tests do,
however, still share the user's default tmux server and can add leaked sessions
to the live observation load.

### Startup and terminal recovery amplify controller failure

The native app starts a server after a one-second probe failure. Every child
exit schedules another start after 150 ms without first probing port 4321 and
without a retry budget. If another server still owns the port, each child exits
with `EADDRINUSE` and the app creates a tight restart storm. An installed
LaunchAgent plist is a second possible owner; it was present but unloaded
during the reproduction.

The browser terminal writes `[session ended]` on every WebSocket close and
never reconnects. A server restart therefore looks like the tmux session died
even when tmux still owns the live agent. The CLI uses an unbounded `fetch` and
does not attach an operation ID, deadline, or structured layer to errors.

### Capacity envelope

The initial regression envelope is 200 retained sessions, 50 panes requiring
active classification, 25 terminal WebSockets, and a burst of 100 queued
messages. It is approximately ten times the 17-session live snapshot observed
during the incident. It is a test workload, not a hard maximum.

Within this envelope:

- concurrent readers share one versioned session observation;
- no more than eight pane-capture operations run concurrently;
- a stalled tmux command, controller call, request body, or client command has
  a deadline and a named error;
- per-target ordering is preserved while independent message targets make
  bounded parallel progress;
- queue and socket backpressure reject excess work explicitly;
- gateway health, static assets, and existing terminal transport do not wait
  for vault projection or pane classification;
- restart delay grows after repeated failure and resets only after a stable
  generation.

Structural tests enforce coalescing, concurrency, bounds, retry state, and
isolation. A local load test records latency and event-loop delay without using
fragile wall-clock assertions as the only correctness signal.

## Relevant architecture decisions

- ADR-0023 makes each pipeline step a real tmux conversation and defines
  `tangent goal handover` as its completion event.
- ADR-0024 makes an Area brain a long-lived tmux session and gives its durable
  record and inbox to Agent Shell.
- ADR-0028 establishes start-new-before-ending-old for context continuation and
  brain-style handover safety.
- ADR-0031 chooses capability ownership inside Agent Shell. It previously
  rejected a process split because no demonstrated isolation need existed.
  The 2026-08-24 outage supplies that missing evidence. Capability boundaries
  remain useful inside the controller.
- `ARCHITECTURE.md` makes Agent Shell the single normal vault writer and allows
  private module and loopback contracts to change atomically.

## Lens analysis

### Architecture, types, and data

Authorities:

- Vault Markdown owns Area, Goal, Document, and Goal status facts.
- Pipeline, brain, inbox, request, and continuation records own their workflow
  transitions.
- Tmux owns current process and pane existence only.
- The controller owns commands and derived projections.
- The gateway owns connectivity and the last complete session response.

Process recovery has no authority to change tmux session lifetime. Existing
workflow transitions retain their current explicit lifetime behavior.

### API

Gateway-to-controller calls need operation IDs, deadlines, and structured
outcomes. Mutations return accepted, completed, conflicted, or unavailable
with the operation ID. The gateway never retries a mutation automatically. An
exact advance retry for an already-running live step returns the committed
result; other uncertain mutations require a state read before retry.

The gateway caches complete successful session responses. It never publishes a
partial response. On controller failure it serves the last response with stale
metadata, capture time, and controller health.

### Operations

The gateway checks a heartbeat generated from the controller event loop. A
controller that stops heartbeats is restarted after a bounded delay. The native
launcher validates gateway identity, re-probes, and backs off separately. OS
process existence alone is not health, as the failed Node process remained
alive and bound to its port.

Required diagnostics:

- gateway and controller boot IDs;
- current controller boot and last session-response capture time;
- event-loop delay and heartbeat age;
- controller operation duration by capability;
- vault index build duration and input counts;
- pane sample count and duration;
- exact Goal file, pipeline step, brain generation, and session name in every
  lifecycle log;
- public port owner, controller PID and boot ID, restart attempt and delay,
  request operation ID, response deadline, and whether a snapshot was stale.

Every scan has an input count, size bound, deadline, and cancellation signal.
Regular-expression parsers reject or truncate inputs above their documented
limit. CPU-heavy document projection can move to a worker thread inside the
controller if measured data still requires it. That does not replace the
gateway/controller process boundary.

### UI/UX

The common path is opening a brain and continuing its conversation. The
terminal must mount from gateway state without waiting for a fresh vault index.

The app distinguishes a stale work projection from a terminal failure. It
keeps the last terminal frame during reconnect. It shows a compact delayed
state with retry progress. It shows an explicit terminal error when tmux attach
fails. Empty black content is not a state.

This change does not add automatic session cleanup. Retained sessions remain
visible and inexpensive within the capacity envelope.

## Candidate designs

### A. Keep one process and add timeouts, caches, and smaller modules

For:

- Small deployment change.
- Consistent with ADR-0031's modular monolith.
- Direct function calls and simple debugging.

Against:

- JavaScript timeouts cannot interrupt synchronous regular-expression or
  serialization work on the same event loop.
- The observed process stayed alive and bound to its port while every HTTP and
  terminal request starved.
- A worker thread for one known parser leaves future control paths able to
  block the gateway.

Rejected because it does not satisfy the primary failure-isolation contract.

### B. Gateway plus controller worker process

For:

- Keeps terminal streaming independent from application CPU work.
- Preserves one package and one local product.
- Allows cached stale reads while control work restarts.
- Reuses ADR-0031 capabilities inside the controller.

Against:

- Adds IPC heartbeats, private HTTP proxying, health, and child restart behavior.
- Requires explicit partial-success and retry semantics for commands.

Selected. The demonstrated failure justifies this operational boundary.

### C. One process per capability

For:

- Maximum fault isolation.
- Independent scaling and restart.

Against:

- Vault writing, pipeline changes, brain notices, and session commands form
  coordinated workflows. Splitting each capability creates distributed
  transactions without a demonstrated need.
- More processes and IPC contracts increase diagnosis cost for one local user.

Rejected. Two failure domains are sufficient: interaction and control.

## Session cleanup alternatives

### Infer completion from Goal status during reconciliation

This cleans old sessions, but status is too broad. A Goal can close while a
session still owns an authorized final action. An unindexed path can be a move,
test fixture, or damaged record. Reconciliation also lacks the exact causal
event that made cleanup safe.

### Keep existing explicit session lifetime

Selected for this resilience change. Recovery never destroys tmux work. The
capacity envelope and bounded observation make retained sessions safe without
inferring that a completed record authorizes deletion.

### Persist cleanup from the completion transition

Deferred. The same application operation that persists completion knows the
exact session and causal event. It writes `cleanup-pending` before attempting
the idempotent tmux end, but this changes visible pipeline and append behavior.
It requires a separate product decision and migration; it is not needed to
contain the demonstrated outage.

## Decisions

1. Let the native app or one optional LaunchAgent ensure the gateway exists.
   The gateway alone starts and supervises the controller.
2. Keep terminal attachment in the gateway. Do not proxy terminal bytes through
   the controller.
3. Cache complete successful session responses in the gateway. Serve the last
   response with explicit staleness during controller failure.
4. Put all vault scans, projections, pane classification, reconciliation,
   message delivery, and workflow mutation in the controller.
5. Never end a tmux session as part of gateway or controller recovery.
6. Bound session observation, pane capture, tmux subprocesses, message queues,
   terminal sockets, request bodies, response waits, and restart attempts.
7. Run tmux integration tests on a separate tmux socket. End that test server
   even when individual fixtures fail.
8. Record ADR-0032 and clarify ADR-0031's controller composition-root scope.
9. Treat the capacity envelope as a regression workload. Keep concurrency and
    queue limits configurable for diagnostics, but do not expose a user-facing
    session cap.
10. Resolve one Goal and its prompt context with targeted reads. A mutation may
    use a shared complete projection only when the projection is already
    current; it must not rebuild the whole vault synchronously.
11. Give the public listener one owner. A native app or LaunchAgent may ensure
    that owner exists, but neither may run an unconditional child restart loop.

## Migration and compatibility

The gateway and controller read every current durable schema unchanged. No
tmux metadata or vault migration is required. Existing sessions remain alive.

The browser, CLI, gateway, and controller ship together. Their private HTTP and
IPC shapes can change atomically. IPC carries only ready and heartbeat facts;
the controller HTTP listener is loopback and ephemeral.

## Risks, assumptions, and open questions

- Risk: other suffix allocators can repeat the same truncate-after-append
  defect. All runtime name allocation must use the bounded shared allocator;
  the exact 60-character collision remains a regression fixture.
- Risk: controller restart during a mutation. The gateway never retries it.
  The CLI names uncertainty and the operation ID; exact pipeline advance retry
  is idempotent, and other callers must inspect state first.
- Risk: stale snapshots hide a new work transition. The app labels staleness
  and mutation routes fail closed while the controller is unavailable.
- Decision resolved: Node child-process IPC carries readiness and heartbeats;
  private loopback HTTP carries controller requests and responses.

## Sources

- `packages/agent-shell/app/server.mjs`
- `packages/agent-shell/app/gateway.mjs`
- `packages/agent-shell/app/runtime-scheduler.mjs`
- `packages/agent-shell/app/terminal-transport.mjs`
- `packages/agent-shell/app/pane-observer.mjs`
- `packages/agent-shell/app/session-safety.test.mjs`
- `packages/agent-shell/app/rebuild-operation.mjs`
- `docs/decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md`
- `docs/decisions/ADR-0024-area-brain.md`
- `docs/decisions/ADR-0028-worker-context-continuation.md`
- `docs/decisions/ADR-0031-agent-shell-capability-ownership.md`
- `docs/decisions/ADR-0032-agent-shell-resilient-runtime.md`
- `docs/design/agent-shell-architecture-boundaries.md`
- Live `tmux list-sessions`, `tmux capture-pane`, HTTP probes, LaunchAgent
  status, and macOS process samples collected on 2026-08-24.
