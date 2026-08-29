# ADR-0050: Make worker question answers durable control events

Date: 2026-08-29

Status: accepted. Amends the question and message clauses of ADR-0021 and ADR-0040.

## Context

A worker question was a durable Goal queue report. The brain answer was only a generic agent message.

The message could wait for an empty composer. It also did not resolve the queue report after pane delivery.

One production Goal received the answer several times. Four attempts still inherited `Asked the brain` from the original report.

## Decision

Each `question-needed` report owns one stable question ID and durable question state in `area-goal-queue.v2`.

Only the exact current live Area brain can answer the question. It uses the existing `tangent send <worker>` command.

The target can name the source attempt or its current replacement. The queue resolves the recipient from exact assignment and attempt history.

The queue stores the answer before the send command reports success. It changes a waiting assignment to running when a current attempt exists.

The worker question command waits through an HTTP control channel. It prints the answer as command output and acknowledges the exact recipient.

This channel does not inspect or write the harness composer. Claude, Codex, and Pi use the same channel.

Replacement promotion transfers each open or unacknowledged question to the replacement attempt. A stale source waiter receives `transferred`.

Rebuilt and replacement prompts contain open questions and committed answers. An answer with no live recipient waits in the Goal queue.

The answer operation ID provides idempotency. A different concurrent answer fails while the first answer waits for acknowledgement.

Old question reports derive their stable question state when read. The first answer writes the explicit state.

Generic messages keep their existing durable queue, composer gate, ordering, and shell refusal.

## Consequences

An answered worker cannot remain in `Asked the brain`. Live pane observations provide its next state.

The Goal queue now records answer authority, recipient transfer, and acknowledgement. These facts survive a controller restart.

The CLI can wait during a brain response. If the controller restarts, the CLI retries until the durable answer becomes available.

Old CLI versions still submit questions and exit. A later attempt receives the stored answer through its rebuilt prompt.
