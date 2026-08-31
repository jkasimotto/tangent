# ADR-0053: Remove Journal, remember, Ideas, and Threads

Date: 2026-08-31

Status: accepted

## Context

Tangent had two durable paths for unstructured Area text. One path used vault files. The other path used the durable Area inbox.

The extra path created storage, routes, commands, prompts, request effects, map kinds, and browser behavior. Its concepts also remained in current documentation.

## Decision

Remove Journal storage and all code that reads or writes it. Remove the `/remember` skill and its instructions.

Remove Ideas storage, commands, routes, projections, actions, and map metadata. Remove Threads from current product language.

Keep Areas, Goals, Documents, Document Comments, Requests, milestones, and map promotions. Requests accept only the `goal-done` effect.

Area notes use `## Open questions`. A one-shot migration preserves each existing section body without classification.

The migration appends each separate Idea payload to its Area note. It does not create Goals or Documents.

Spoken and typed notes use `POST /api/agents/send`. The route writes the durable Area inbox before live delivery.

The voice route keeps transcription. It returns the transcript with the standard Area delivery object.

The removed routes return the normal 404 response. No compatibility reader, renamed replacement, or warning route remains.

## Migration

The deployment stops the old Agent Shell before preflight. Preflight records hashes and rejects new or ambiguous data.

The migration writes Area notes atomically. A retry does not append a payload twice.

The migration removes the known implementation-proof entry and its matching runtime records. The migration manifest preserves the source hashes.

## Consequences

An inactive brain does not start when a message arrives. The interface reports `Queued` until the brain starts.

Area History shows finished Goals only. Flat Document storage stays unchanged.

The governance lint rejects the removed vocabulary in current product code, instructions, and architecture documents.
