# ADR-0034: Use one audited workflow for each Area brain

Date: 2026-08-26

Status: accepted. The worker verb clause is amended by ADR-0040: `tangent send brain` is the worker command, plain text is a note with no status change, and the typed `--report` stays only on the aliases. The completion policy, designated review, brain handover, and Test request clauses are superseded by ADR-0041.

Amended 2026-08-28: the Area brain controls the Goal queue but is never a Goal owner or attempt. The server rejects all brain generations at each Goal-binding writer. Reads quarantine contaminated bindings. Reconciliation clears the Goal binding and stops an invalid queue assignment without terminating the brain session.

The Journal routing clauses are superseded by [ADR-0053](ADR-0053-remove-journal-remember-ideas-and-threads.md).

## Context

The Area brain workflow had conflicting execution, authority, closure, lifecycle, Question, memory, and Operation paths.

The reviewed audit and product vision require one durable writer for each mutable workflow record.

## Decision

Area paths organize records and message destinations. They do not grant command permission.

Any local caller can act directly on work in any Area. This includes brains, workers, the browser, and a local shell. Caller identity is audit provenance, not an Area capability.

The target Area receives a durable event after the state commit. Its logical inbox exists before its brain becomes active. A missing or inactive brain does not block the command.

One `area-goal-queue.v2` record controls each Goal execution. Pipeline and solo records are read-only migration evidence after queue conversion.

Normal worker starts use the Goal queue directly. They do not require a live Area brain. A guarded recovery start creates a marked `julian-emergency` attempt in that queue.

The Goal queue remains the single writer for assignment state. Per-Goal locks, expected revisions, and idempotency keys serialize callers.

A normal command cannot steal or terminate a different live owner. Stop and replacement require the exact current attempt and immutable tmux target.

Workers submit tagged reports to the queue controller. Only a designated review assignment can submit a `review-result` report.
A brain appends that assignment with `--kind review`. The queue defaults to `implementation`, and instruction text never changes the explicit type.

`tangent handover` and `tangent goal handover` use one report parser and one server route. The route rejects damaged report input before it mutates the queue.

Each accepted worker submission adds a receipt to its exact Goal assignment. The receipt stores the queue result and the exact Area inbox notice identity.

The receipt is a durable outbox until it holds a notice ID. Retry and reconcile use one stable source ID, so they repair the notice without adding a second notice.

A routine Goal closes after a `passed` review with complete criteria. The report revision must equal the current Goal revision.

Free text never closes a Goal. A Goal that needs human judgment uses a revision-bound Question effect.

Free text is durable `untyped-evidence`. It produces a brain notice, but its assignment stays waiting until the queue accepts a typed report.

Every Question accepts a durable reply. A Question can also offer one allowlisted, revision-bound effect with a preview.

The server stores an effect operation before execution. A failed effect leaves the Question open and records its Problem.

The brain prompt includes bounded Area memory. The exact Area contributes `Purpose`, `Current`, and `Knowledge`.

Ancestor Areas contribute `Purpose` and `Knowledge` with smaller budgets. The prompt reports source paths, hashes, clipping, and omissions.

Only explicit current relationships select Documents. Open Goals, open Requests, and the current source instruction can select a Document reference.

Completed Goals and recent modification times never select prompt Documents. Document bodies remain available through an explicit read.

A brain has `active` or `inactive` product state. Process health, attempts, and recovery remain diagnostic data.

Every attempt receives the founding instruction. A replacement also receives the latest durable checkpoint.

Operation events use condition edges plus declared results. New Problems, changed Problems, resolutions, and declared outputs are material.

Routine starts, routine stops, unchanged health, and repeated success are not material. Event identity makes delivery idempotent.

## Superseded clauses

The 2026-08-27 permissive command amendment supersedes this ADR's exact-Area mutation and live-brain start clauses. It does not supersede the exact Area inbox, one Goal queue, typed reports, immutable attempt history, or review-based automatic closure.

This ADR supersedes the closure, lifecycle, and descendant-inbox clauses in ADR-0024 that conflict with this workflow.

This ADR supersedes ADR-0029 clauses for ancestor mutation authority, cross-Area worker starts, legacy pipeline control, and Test-request closure.

This ADR supersedes the ADR-0030 statement that trigger workers never report through an Area brain. Material trigger events now reach the exact inbox.

ADR-0033 remains the product direction. This ADR defines its command, closure, memory, Question, lifecycle, and event contracts.

## Consequences

The server validates the target Area, schema, revision, queue state, ownership, and immutable attempt fields. It records actor session, actor Area when known, target Area, operation ID, and result.

A worker sees success only after the queue receipt links to its inbox notice. A notice-write failure tells the worker to retry the same handover.

One release can read old execution and response shapes. New mutations write only the audited records.

Ambiguous migrations pause the queue. The server does not choose between multiple live attempts.

Agent Shell shows Active or Inactive as lifecycle. It shows health and recovery as supporting detail.
