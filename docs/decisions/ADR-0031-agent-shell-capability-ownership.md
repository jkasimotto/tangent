# ADR-0031: Agent Shell internals use capability ownership

Date: 2026-08-24

Status: accepted

## Context

Agent Shell grew from one server module and one browser module. File extraction reduced individual file size but left the same central ownership. The browser event boundary accepted 115 named dependencies. `shell.js` attached unrelated services to functions and passed a mixed service bag under the name `programById`. The server kept launch resolution, pane sampling, message queues, and their mutable state in `server.mjs`.

Agent Shell has one user and no external loopback API consumers. Its durable vault and workflow records are valuable. Its private module and HTTP shapes are not compatibility contracts.

## Decision

Agent Shell is a capability-owned modular monolith.

- Browser factories receive records owned by a feature or shell capability. They do not receive flat lists of unrelated functions. `shell.js` is the composition root. `shell-coordinator.js` coordinates navigation between Work, Areas, Programs, launch, Documents, and shared chrome. Capabilities are never attached as properties of functions.
- Server mechanisms with mutable state own that state behind a narrow factory. `launch-catalog.mjs` owns registry reads, inherited and requested resolution, registry writes, and Area-default writes. `message-delivery.mjs` owns queue order, readiness policy, audit logging, retargeting, and notice settlement. `pane-observer.mjs` owns pane samples and derived agent state.
- Route modules remain transport adapters. Persisted record modules remain the only readers and writers for their schemas.
- Private module and loopback contracts may change atomically with their in-repository callers. Vault Markdown, Git provenance, tmux bindings, and durable workflow records must remain readable and recoverable.
- New ownership boundaries need contract tests. Tests inspect the owning module when behavior moves; they must not require an implementation to remain inside `server.mjs` or `shell.js`.

## Consequences

- A low argument count is not sufficient by itself. Each constructor record must have one owner and lifecycle.
- No dependency-injection container or generic service bag is allowed.
- `server.mjs` remains the process composition root while complete capabilities move out of it. New launch, message-delivery, or pane-observation behavior belongs to its owner, not back in the root.
- Existing stored records need no migration for this change.
