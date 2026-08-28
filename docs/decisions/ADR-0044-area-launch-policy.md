# ADR-0044: Areas control agent launches

Date: 2026-08-28

Status: accepted. Design: `docs/design/area-launch-policy/design-record.md`.

## Context

Agent Shell stored separate Work and Brain defaults in each Area note. A default guided a selector but did not prevent a launch.

This behavior let an Otto Goal use a Neara harness. It also made Julian maintain preferences that the product can learn from successful launches.

## Decision

1. An Area note can contain a `tangent.environment.v2` policy. Its `allow` list uses `harness[/model[/effort]]` patterns.
2. A child policy intersects with each ancestor policy. Thus, a child can narrow an inherited policy but cannot widen it.
3. If no ancestor declares a policy, the Area is unrestricted. Agent Shell does not invent a launch for an unrestricted Area.
4. Agent Shell checks the effective policy before each new Brain or worker process. The check also applies to a Brain that lends its launch.
5. Agent Shell stores the last successful Brain and Work launch for each Area in `launch-memory.json`.
6. A selector uses the nearest valid memory entry. If no valid entry exists, it uses the first launch in the effective policy.
7. Agent Shell filters stale memory during each read. It does not change historical attempt snapshots.
8. `POST /api/launch/default` returns `410 defaults-retired`. `POST /api/launch/policy` writes the Area policy.

This decision amends ADR-0035 and ADR-0037. Their launches now pass the same Area policy check.

## Consequences

- A disallowed new launch returns `launch-not-allowed`. The response names the Area, launch, and allowed patterns.
- Old Goal and Brain records remain readable. A new process from an old queued assignment must pass the current policy.
- The runtime memory does not add commits to the vault.
- `tangent study` remains outside this policy because it has no Area.
