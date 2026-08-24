# ADR-0032: Agent Shell isolates its public edge from workflow control

Date: 2026-08-24

Status: accepted

## Context

Agent Shell previously put the port-4321 listener, static UI, terminal
WebSockets, tmux observation, vault projection, pipeline mutations, and
background reconciliation in one Node process. On 2026-08-24,
`tangent brain advance` entered an infinite session-name retry loop. A
60-character occupied name lost its appended retry suffix when it was
truncated, so the loop tested the same name forever. The event loop stopped,
the CLI reported only `fetch failed`, every terminal socket closed, and the
native launcher retried a replacement every 150 ms. A second possible port
owner turned that behavior into an `EADDRINUSE` restart storm.

Tmux sessions and workflow records survived, but every access path made the
same controller failure look like the agents themselves had ended.

## Decision

Agent Shell has two local processes with different failure domains.

- `gateway.mjs` is the only owner of the public loopback port. It owns static
  assets, `/api/health`, server-sent invalidations, and terminal WebSockets.
  It proxies workflow API calls to one supervised controller.
- `server.mjs` is the controller composition root. Under the gateway it binds
  an ephemeral loopback port and owns vault, workflow, messaging, observation,
  and reconciliation operations. It sends ready and event-loop heartbeats over
  IPC.
- A missed heartbeat terminates and replaces only the controller. Restart
  delay grows exponentially and resets after a stable generation. Tmux
  sessions, terminals, and the public gateway remain alive.
- The gateway keeps the last valid `/api/sessions` response. During controller
  recovery it serves that response with explicit stale metadata. Mutations get
  a named 503 or a transport-uncertain CLI error; they never appear to have
  ended every session.
- The native launcher validates the gateway health identity, probes again
  before every launch, and uses exponential backoff. A competing public-port
  process cannot cause a child restart loop.
- Session-name allocation reserves semantic suffix space before truncation and
  has a finite candidate budget. Tmux commands, pane fan-out, request bodies,
  client responses, message queues, SSE clients, terminal sockets, and restart
  loops have explicit time or capacity bounds.
- Concurrent callers share one short-lived session observation. A failed tmux
  refresh retains the last valid snapshot. Pane classification and independent
  message targets make bounded parallel progress while preserving per-target
  order.
- Every integration test that invokes real tmux uses a private socket and
  kills only that socket on process exit. Tests cannot observe, load, or delete
  the user's live sessions.

The working regression envelope is 200 retained sessions, 50 observed agent
panes, 25 attached terminals, and a burst of 100 messages. It is not a product
limit.

## Consequences

- Controller bugs can delay mutations, but they do not blank terminal panes or
  make the shell health endpoint disappear.
- A cached session view can be stale during recovery. Its response and runtime
  metadata identify that state; it is never represented as an empty live set.
- Tmux and durable records remain outside both processes. The supervisor never
  kills a user session as part of process recovery.
- `server.mjs` remains the controller composition root described by ADR-0031.
  `gateway.mjs` is a process edge, not a second workflow composition root.
- The private controller HTTP contract may change with the gateway. Port 4321,
  the CLI behavior, tmux bindings, vault Markdown, and durable workflow records
  remain compatible.
