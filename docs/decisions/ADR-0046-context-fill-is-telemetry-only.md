# ADR-0046: Context fill is telemetry only

Date: 2026-08-28

Status: accepted. Supersedes the proactive threshold, reminder, and replacement rules in ADR-0028.

## Context

Tangent observed a worker's context fill. At 300,000 tokens, it told the worker to stop at a natural pause and send facts to the Area brain. It sent a stronger message after the worker used more tokens.

This made workers and Julian manage context. A token count is not a terminal condition. The harness already owns context compaction and its real runtime limits.

## Decision

Context fill is diagnostic telemetry only. Tangent can record and show the fill for a live or past attempt. A fill value cannot:

- send or queue a worker message;
- create a notice or attention state;
- request a handover;
- start, replace, or stop an attempt;
- change a Goal or pipeline record.

Workers continue until they report completion, a question, or a blocker, or until the harness has a real terminal condition. Explicit user and brain actions can still start or resume an attempt. Quota, authentication, runtime failure, dead-session recovery, and worker reports keep their existing behavior.

Old continuation and reminder fields stay readable for compatibility. Tangent does not write reminder state from context fill.

## Consequences

- The reconciliation scheduler does not inspect context fill to manage workers.
- The session API does not publish a handover threshold.
- The prompt bestiary does not describe context risk as a lifecycle transition.
- Tests reject any new threshold authority while keeping context telemetry and explicit recovery available.
