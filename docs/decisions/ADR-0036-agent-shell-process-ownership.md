# ADR-0036: Agent Shell owns processes by runtime identity

Date: 2026-08-27

Status: accepted

## Context

All Agent Shell controllers could see the same tmux server. Session names and
workflow tags described work, but they did not identify the controller that
created a process.

Reconciliation and cleanup could therefore stop a session from another Agent
Shell. A test controller could also stop work from the primary controller.

Controller restart created a second problem. A stopped process has no live tmux
option, but reconciliation still needs safe evidence about its former owner.

## Decision

Each Agent Shell has one stable runtime identity.

- `TANGENT_SHELL_INSTANCE_ID` sets the identity when an operator supplies it.
- Otherwise, Agent Shell hashes its public host, port, trees root, and chat
  session. The gateway passes this identity to every replacement controller.
- Two processes with the same identity are one ownership domain. Independent
  Agent Shell instances must use different identities.
- Every created tmux session gets the session option
  `@tangent_agent_shell_instance`. Creation and termination use tmux's immutable
  session ID, so a same-name replacement cannot cross the boundary.
- A sidecar under `~/.tangent/agent-shell/session-owners/` records the session
  name and instance identity. It supplies ownership evidence after a process
  disappears.
- Goal queues, attempts, brain records, and brain generations also record the
  instance identity. These records support diagnosis and stale recovery.
- `session-ownership.mjs` is the only production module that can run tmux
  `kill-session`. Callers receive `terminated`, `foreign`, `legacy`, `absent`,
  or `error`.
- Session projections expose only processes owned by the current instance.
  Internal snapshots retain foreign names for collision and absence checks.
- Reconciliation treats a foreign live process as present but never mutates it.
  Missing-process recovery needs a current-instance record or sidecar.
- A markerless process is legacy. Agent Shell does not stop it or use its
  absence as recovery evidence. One compatibility exception exists for an
  explicit brain resume. The session, Area, generation, and live brain tags
  must match the durable brain record before the current instance claims it.
- Rebuild and shutdown stop gateway or controller processes only. They do not
  stop tmux sessions.

All integration tests use private tmux sockets. The ownership tests also run
two controllers on one private socket and exercise every termination path.

## Consequences

- A secondary Agent Shell cannot stop the primary instance's workers or brains.
- A replacement controller can recover processes when it keeps the same
  identity.
- Changing the identity creates a new ownership domain. Old sessions remain
  safe and appear foreign.
- Arbitrary legacy sessions remain alive until they finish or an operator
  removes them. Explicit resume can claim an exact legacy brain. Relaunching
  other work through Agent Shell creates the required marker.
- Runtime diagnosis needs the health identity, live tmux option, durable
  sidecar, and workflow record. The operations guide gives the commands.
