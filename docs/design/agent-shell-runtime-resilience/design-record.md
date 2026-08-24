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
symbolized, so the exact expression is unknown.

Restarting Agent Shell produced one successful snapshot, then the same loop.
Disabling the always-active reconciliation task removed one trigger. Repeated
`/api/sessions` requests still triggered the CPU loop. Removing vault-wide
For-Julian enrichment from the polling snapshot restored stable responses:
five requests completed in 0.03 to 0.38 seconds and CPU stayed near idle.

These facts establish two independent unbounded paths in the presentation
process. They do not prove which regular expression is defective.

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
- Pipeline, brain, inbox, request, continuation, and cleanup records own their
  workflow transitions.
- Tmux owns current process and pane existence only.
- The controller owns commands and derived projections.
- The gateway owns connectivity and the last complete published snapshot.

The current system confuses an observed process with retained work evidence.
A completed tmux process has no durable authority after its handover is stored.
The new cleanup record makes partial completion explicit and retryable.

### API

Gateway-to-controller calls need operation IDs, deadlines, and structured
outcomes. Queries return a snapshot version and observation time. Mutations
return accepted, completed, conflicted, or unavailable with the operation ID.
The gateway never retries a mutation automatically. The controller deduplicates
an explicitly retried operation ID.

The controller publishes complete snapshots. The gateway never merges fields
from two controller versions. On controller failure it serves the last version
with `stale: true`, `observedAt`, and controller health.

### Operations

The supervisor checks a heartbeat generated from each child's event loop. A
process that stops heartbeats is restarted after a small fixed budget. OS
process existence alone is not health, as the failed Node process remained
alive and bound to its port.

Required diagnostics:

- gateway and controller boot IDs;
- current and last published snapshot versions;
- event-loop delay and heartbeat age;
- controller operation duration by capability;
- vault index build duration and input counts;
- pane sample count and duration;
- cleanup queue depth, oldest age, retries, and last error;
- exact run ID, Goal file, pipeline step, brain generation, and session name in
  every lifecycle log.

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

Natural cleanup removes completed workers from active Work views. Historical
evidence comes from the handover, captured final tail, and provider transcript,
not a hidden live session.

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
- Preserves one package, one local product, and one supervisor.
- Allows cached stale reads while control work restarts.
- Reuses ADR-0031 capabilities inside the controller.

Against:

- Adds IPC, snapshot versioning, health, and child restart behavior.
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

### Keep every session until Julian stops it

This is the current behavior. It avoids accidental destruction but turns every
successful run into an operating-system leak. The handover and provider
transcript already preserve the useful result.

### Persist cleanup from the completion transition

Selected. The same application operation that persists completion knows the
exact session and causal event. It writes `cleanup-pending` before attempting
the idempotent tmux end. Restart can resume it. Ambiguous sessions never enter
this flow.

## Decisions

1. Run a gateway and controller as sibling child processes under one
   LaunchAgent supervisor.
2. Keep terminal attachment in the gateway. Do not proxy terminal bytes through
   the controller.
3. Publish versioned complete snapshots from controller to gateway. Serve the
   last snapshot with explicit staleness during controller failure.
4. Put all vault scans, projections, pane classification, reconciliation,
   message delivery, and workflow mutation in the controller.
5. Add durable, idempotent cleanup state to managed run records. Persist the
   lifecycle transition before ending tmux.
6. Auto-clean only sessions with a stable run ID whose tmux metadata and owner
   record agree.
7. Capture a bounded final pane tail before cleanup. Do not preserve a process
   as history.
8. Keep current brains alive. Clean a brain only after a confirmed replacement,
   explicit stop, or recorded terminal failure.
9. Run tmux integration tests on a separate tmux socket. End that test server
   even when individual fixtures fail.
10. Amend ADR-0031 during implementation because the demonstrated isolation
    requirement changes its process-boundary conclusion.

## Migration and compatibility

The gateway and controller first read every current durable schema. A new
managed-run or cleanup schema can be added without rewriting vault Markdown.

Existing tmux sessions are adopted only when all available facts agree:

- Tangent kind and Area options are present.
- The referenced pipeline, brain, continuation, or Goal record exists.
- That record names the same session in a live state.

Adopted sessions receive a run ID. A mismatch becomes orphaned and remains
alive. Done Goals and completed steps can be offered as a one-time reviewed
cleanup set. Migration must not bulk-kill them without positive identity.

The browser, CLI, gateway, and controller ship together. Their private HTTP and
IPC shapes can change atomically. The gateway rejects a controller with an
unsupported protocol version and reports the mismatch in the app.

## Risks, assumptions, and open questions

- Unknown: the exact CPU-looping expression. Implementation must retain a
  reproducible snapshot fixture and profile each projection stage before the
  temporary recovery guards are removed.
- Risk: controller restart during a mutation. Operation IDs and persisted
  transition-before-effect rules prevent duplicate workflow changes.
- Risk: ending a session before its CLI response paints. Cleanup can execute
  after the response is committed, with a short bounded delay. The durable
  cleanup record remains authoritative during that delay.
- Risk: stale snapshots hide a new work transition. The app labels staleness
  and mutation routes fail closed while the controller is unavailable.
- Assumption: provider-native transcripts remain available for conversation
  history. The final pane tail covers providers or shells where no transcript
  can be resolved.
- Open implementation choice: Node child-process IPC or a local Unix socket.
  Child IPC is simpler under one supervisor. A Unix socket makes independent
  restarts clearer. A spike must compare restart behavior before the contract
  is fixed.

## Sources

- `packages/agent-shell/app/server.mjs`
- `packages/agent-shell/app/runtime-scheduler.mjs`
- `packages/agent-shell/app/terminal-transport.mjs`
- `packages/agent-shell/app/pane-observer.mjs`
- `packages/agent-shell/app/session-safety.test.mjs`
- `packages/agent-shell/app/rebuild-operation.mjs`
- `docs/decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md`
- `docs/decisions/ADR-0024-area-brain.md`
- `docs/decisions/ADR-0028-worker-context-continuation.md`
- `docs/decisions/ADR-0031-agent-shell-capability-ownership.md`
- `docs/design/agent-shell-architecture-boundaries.md`
- Live `tmux list-sessions`, `tmux capture-pane`, HTTP probes, LaunchAgent
  status, and macOS process samples collected on 2026-08-24.
