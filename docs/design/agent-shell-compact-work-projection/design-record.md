# Compact Agent Shell Work Projection

Date: 2026-08-28
Status: designed

## Problem contract

The Agent Shell browser reads three complete projections after each invalidation. The current vault contains 332 Goal queues and 778 assignments.

`GET /api/sessions` returns 8,510,796 bytes. Only 11,135 bytes describe live sessions. Queue history uses 6,993,737 bytes, and brain history uses 1,497,662 bytes.

`GET /api/vault` returns another 4,551,231 bytes. One normal refresh therefore transfers more than 13 MB before browser rendering starts.

The session response exceeded the gateway limit of 8 MiB. The gateway rejected a valid controller response and showed a controller-restart state.

The immediate correction increased the bounded gateway allowance to 32 MiB. This change restores service but does not correct the payload design.

### Success conditions

- The initial Work response contains current list and row state only.
- The current vault produces a Work response of less than 512 KiB.
- The gateway rejects any Work response larger than 8 MiB.
- A normal refresh does not include historical handovers, reports, attempts, notices, or brain generations.
- Goal and brain detail remain available through targeted requests.
- Controller recovery keeps terminal connections and the last valid Work response available.
- Stored Goal queue and brain records do not require migration.

### Non-goals

- This design does not remove durable Goal queue history.
- This design does not change queue or brain lifecycle rules.
- This design does not move workflow authority into the browser or gateway.
- This design does not change the public loopback address.

## Current system

### Goal queue records

**Observed:** One `area-goal-queue.v2` JSON record exists for each Goal that has started assignments. The record persists under `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`.

The record contains ordered assignments. Each assignment contains its instruction, launch choice, attempts, reports, handovers, receipts, status, and timestamps.

The name `pipeline` remains in file paths and HTTP routes. The current product model calls this record a Goal queue.

**Observed:** The current 332 queue records contain these 778 assignments:

| Status | Count |
|---|---:|
| Complete | 636 |
| Ended | 128 |
| Skipped | 3 |
| Pending | 5 |
| Running | 4 |
| Stopped | 1 |
| Waiting | 1 |

Thus, 767 assignments are final. Eleven assignments are non-final. The number 778 is accumulated history, not concurrent work.

### Duplicate queue representation

**Observed:** `normalizeQueueRecord()` returns the same assignment array through two keys:

```js
{
  assignments,
  steps: assignments,
}
```

This alias supports old `steps` callers during the queue terminology migration. JSON serialization cannot preserve an object alias.

The serializer writes the full array under both keys. In the current response, `steps` uses 3.43 MiB and `assignments` uses 3.36 MiB.

The largest duplicated values are worker handovers and assignment instructions. Reports, evidence references, attempts, and receipts add more history.

### Brain representation

**Observed:** The response contains all 666 historical brain generations and 910 notice bodies. Historical generation handovers use 859 KiB. Notice text uses 355 KiB.

### Browser refresh

**Observed:** `readProjection()` requests `/api/vault`, `/api/sessions`, and `/api/operations`. It waits for all three requests before it updates the screen.

The browser needs compact current state for Work rows. It does not need every historical report or notice for this operation.

The existing `GET /api/goals/detail?goal=<file>` endpoint already loads one complete Goal reader model on demand. This endpoint is the closest internal precedent.

## Why the gateway exists

**Observed:** `gateway.mjs` owns port 4321, static assets, terminal WebSockets, server-sent events, and `/api/health`. It supervises the replaceable controller process.

This boundary was introduced after a controller event-loop error closed all terminal sockets. The gateway keeps terminal processes and browser connections alive during controller replacement.

**Decision:** Keep the gateway as the stable transport and terminal boundary.

The gateway must not become a second workflow controller. Reading files does not produce the required Work state by itself.

The Work state also needs these facts:

- live tmux ownership and session identity;
- pane state and context observations;
- derived queue status against live sessions;
- current brain health and recovery state;
- current commit and rebuild state;
- normalized compatibility records and cross-record joins.

If the gateway reads these files, it must import or duplicate controller rules. A malformed record or expensive join can then block terminal traffic again.

The gateway can read a static file only if another process owns and atomically writes that complete read model. This extra file adds no value over an opaque memory cache.

## Selected design

### One compact Work endpoint

**Decision:** Add `GET /api/work` as the browser bootstrap and refresh endpoint.

The controller owns this read model. The response contains current rows, counts, identities, and commands. It contains no durable history bodies.

Representative shape:

```ts
type WorkProjectionV1 = {
  schema: "agent-shell-work.v1";
  revision: string;
  generatedAt: string;
  controller: {
    boot: string;
  };
  shell: {
    sourceChanged: boolean;
    deployedCommit: string;
    currentCommit: string;
    pendingCommitCount: number;
    rebuild: RebuildSummary | null;
    caffeinate: boolean;
    voice: boolean;
  };
  areas: AreaRow[];
  goals: GoalRow[];
  queues: GoalQueueRow[];
  brains: BrainRow[];
  sessions: SessionRow[];
  programs: ProgramRow[];
  problems: ProblemRow[];
};

type GoalQueueRow = {
  goal: string;
  revision: number;
  status: "pending" | "running" | "waiting" | "stopped" | "complete";
  current: AssignmentRow | null;
  counts: {
    total: number;
    pending: number;
    complete: number;
  };
};

type AssignmentRow = {
  id: string;
  index: number;
  kind: "implementation" | "review";
  status: string;
  instructionPreview: string;
  session: string | null;
  live: boolean;
  state: string | null;
  launch: LaunchSummary | null;
  attemptCount: number;
  reportCount: number;
  updatedAt: string | null;
};

type BrainRow = {
  area: string;
  status: "active" | "inactive";
  session: string | null;
  generation: number | null;
  health: BrainHealthSummary;
  unreadNoticeCount: number;
  updatedAt: string;
};
```

The exact row fields must come from existing Work render dependencies. The implementation must not copy unused fields from the current records.

### Targeted detail endpoints

**Decision:** Keep full history behind targeted endpoints.

- `GET /api/goals/detail?goal=<file>` remains the complete Goal and queue reader.
- Add `GET /api/brains/detail?area=<area>` for one brain and its current generation.
- Add pagination to brain history: `GET /api/brains/history?area=<area>&cursor=<cursor>&limit=<limit>`.
- Keep complete Document Markdown behind the existing targeted Document endpoint.
- Load Area map data only when the user opens the Areas view.

The detail endpoints can return full text because user intent limits the request to one subject. Historical lists must use cursor pagination and a maximum page size.

### Gateway cache

**Decision:** The gateway caches the last valid `/api/work` response as opaque bytes. It does not parse or serialize workflow JSON.

The gateway adds transport facts through response headers:

```http
X-Tangent-Gateway-Boot: <gateway boot>
X-Tangent-Controller-Boot: <controller boot>
X-Tangent-Stale: 0|1
X-Tangent-Captured-At: <ISO timestamp>
ETag: <work revision>
```

The controller includes its boot in the payload for diagnostics. The browser treats the headers as the authority for cache freshness.

The gateway buffers at most 8 MiB for `/api/work`. It stores the buffer only after a complete successful response.

During controller recovery, the gateway returns the stored buffer with `X-Tangent-Stale: 1`. Mutations continue to return a named 503 response.

### Refresh protocol

**Decision:** Server-sent events carry invalidation metadata only.

An event contains a monotonic Work revision and a change class. The browser requests `/api/work` only when the revision differs from its current revision.

The browser sends `If-None-Match` with the current revision. The controller returns `304 Not Modified` when no row data changed.

A 30-second timer remains a recovery path. It must not transfer the payload when the revision is unchanged.

### Data authority

The durable queue and brain records remain authoritative for history. Tmux remains authoritative for live process existence and ownership.

The controller remains authoritative for the joined Work read model. The gateway remains authoritative for public transport health and cache staleness.

The browser owns only display state. It does not merge durable records with live process data.

## Alternatives

### Let the gateway read the disk

Rejected. Disk records do not contain complete live Work state. This choice duplicates joins and compatibility rules in the terminal process.

### Remove the gateway

Rejected. A controller error can then close every terminal WebSocket and public endpoint. This behavior caused the gateway design in ADR-0032.

### Increase the payload limit only

Rejected as the final design. This choice delays the next outage and keeps more than 13 MB on each complete refresh.

### Compress the current payload

Rejected as the primary correction. Compression reduces network bytes but keeps duplicate serialization, parsing, memory, and browser work.

### Store the Work projection in a file

Rejected for the initial design. Atomic file storage can survive a gateway restart, but a gateway restart already reloads the browser.

An in-memory opaque cache is sufficient for controller replacement. A file becomes useful only if measured controller cold-start time blocks normal use.

## Compatibility and rollout

No stored record migration is required. The controller continues to read `area-goal-queue.v2` and current brain records.

1. Add the pure `projectWork()` read-model function and response-size tests.
2. Add `/api/work`, opaque gateway caching, ETag support, and stale headers.
3. Move the browser to `/api/work` behind one temporary capability response from `/api/health`.
4. Move Area map loading to its view-specific request.
5. Remove browser reads of `/api/vault`, `/api/sessions`, and `/api/operations`.
6. Remove the old complete endpoints after CLI and integration callers move to targeted contracts.
7. Remove the `steps` alias from transport projections. Keep compatibility normalization inside the record module.

Each stage can roll back without changing stored records. During stage three, the controller can serve both contracts.

The temporary capability and old bootstrap endpoints must be removed after all in-repository callers use `/api/work`.

## Operations and limits

The `/api/work` response logs its byte count, build duration, queue count, active-assignment count, and stale-cache result. Logs must not contain instructions, handovers, reports, or notice text.

The health response reports the cached Work revision, captured time, byte count, and stale state. It does not report workflow content.

The implementation must add these regression signals:

- The current production vault projection is less than 512 KiB.
- A projection with 500 queues and 1,500 historical assignments remains less than 1 MiB.
- A historical handover of 100 KiB does not change `/api/work` size materially.
- Goal detail still returns that handover for its exact Goal.
- Controller replacement serves the last Work response with stale headers.
- An unchanged revision returns 304 with no response body.
- The gateway rejects a Work response larger than 8 MiB without losing terminals.

## Risks and unknowns

**Unknown:** The current Work views can depend on fields that are not obvious from direct `state.pipelines` references. Implementation tests must record all render inputs before field removal.

**Risk:** A single combined Work response can still grow with the number of open Goals. The 8 MiB limit forces a later paginated list if measured growth reaches that boundary.

**Risk:** ETag revisions must include live session changes. A durable Git revision alone is not sufficient.

**Reconsideration condition:** Add a persisted cache only if measured controller cold start prevents the first Work response for an unacceptable period.

## Evidence

- `packages/agent-shell/app/pipeline-record.mjs`: record normalization, storage, and the `steps` compatibility alias.
- `packages/agent-shell/app/server.mjs`: `pipelinesView()`, `shellStateRoutes.snapshot()`, and vault projection composition.
- `packages/agent-shell/app/public/refresh-lifecycle.js`: complete projection refresh behavior.
- `packages/agent-shell/app/gateway.mjs`: process supervision and session-response cache.
- `packages/agent-shell/app/goal-detail.mjs`: targeted Goal reader precedent.
- `packages/agent-shell/docs/architecture.md`: process and authority boundaries.
- `docs/decisions/ADR-0032-agent-shell-resilient-runtime.md`: stable gateway decision and failure evidence.
