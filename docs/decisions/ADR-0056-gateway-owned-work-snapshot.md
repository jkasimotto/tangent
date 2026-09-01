# ADR-0056: Gateway-owned Work snapshot

Status: accepted. Design: `~/.tangent/trees/otto/tangent/design-one-small-truthful-work-read-model.md`.

## Context

The Work page built a large response during each request. It read the vault,
Jobs, Agents, Brains, Processes, and presentations more than once. A slow read
could reach the controller deadline. A second read could then receive `429`.
The browser also removed known rows when a refresh failed.

## Decision

The controller observes seven exact source classes. Each adapter keeps its last
complete source map. An invalidation is only a hint. The publisher performs an
authoritative reread and sends one bounded `agent-shell-work.v3` candidate to
the gateway.

The gateway validates the complete candidate. It writes an envelope to a
temporary file, syncs the file, renames it, syncs the directory, and then swaps
one immutable memory buffer. The gateway serves that buffer directly from
`GET /api/work`. This route does not enter controller proxy admission and does
not read the file system, Git, tmux, IPC, or the controller.

The store keeps one epoch and increasing revisions. Equal semantic candidates
do not create a revision. An invalid candidate does not replace the current
buffer. A source or controller failure changes transport freshness only. The
response body stays the last truthful complete revision.

The browser reads v3 only. It keeps one active request and one trailing request.
It uses a five-second network deadline, conditional reads, a 30-second recovery
poll, and a session cache that includes the instance and rollout identity.
Refresh errors show `Last known` and keep all known rows.

Non-Work screens use bounded, targeted routes. Work carries three presentation
summaries per owner, one selected Assignment per Goal, one question count per
Brain, and no request, prompt, history, or document-index body.

## Consequences

Work reads are constant-time buffer reads. Concurrent readers do not compete
for controller admission. Controller replacement and source degradation keep
the last complete revision visible.

The store is rebuildable. It is not a command source. Mutations must still use
the owning Goal, Job, Agent, Brain, Process, or presentation route and its
source fence.

The v1 and v2 Work projectors, browser fallback, and optimistic fact merge are
removed. Repository history is the rollback path after this deletion.
