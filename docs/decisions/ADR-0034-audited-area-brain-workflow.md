# ADR-0034: Use one audited workflow for each Area brain

Date: 2026-08-26

Status: accepted

## Context

The Area brain workflow had conflicting execution, authority, closure, lifecycle, Question, memory, and Operation paths.

The reviewed audit and product vision require one durable authority for each mutable workflow record.

## Decision

Each Area brain has exact-Area mutation authority. A parent can read descendant summaries and route exact Journal text.

A parent cannot create, start, advance, or close a child Goal. Each Area inbox exists before its brain becomes active.

One `area-goal-queue.v2` record controls each Goal execution. Pipeline and solo records are read-only migration evidence after queue conversion.

Normal worker starts use the exact Area brain and queue. A recovery-only direct start creates a marked `julian-emergency` attempt in that queue.

Workers submit tagged reports to the queue controller. Only a designated review assignment can submit a `review-result` report.
A brain appends that assignment with `--kind review`. The queue defaults to `implementation`, and instruction text never changes the explicit type.

A routine Goal closes after a `passed` review with complete criteria. The report revision must equal the current Goal revision.

Free text never closes a Goal. A Goal that needs human judgment uses a revision-bound Question effect.

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

This ADR supersedes the closure, lifecycle, and descendant-inbox clauses in ADR-0024 that conflict with this workflow.

This ADR supersedes ADR-0029 clauses for ancestor mutation authority, cross-Area worker starts, legacy pipeline control, and Test-request closure.

This ADR supersedes the ADR-0030 statement that trigger workers never report through an Area brain. Material trigger events now reach the exact inbox.

ADR-0033 remains the product direction. This ADR defines its exact authority, closure, memory, Question, lifecycle, and event contracts.

## Consequences

The server validates exact Area and revision fields before every workflow mutation. It records durable intent before retryable side effects.

One release can read old execution and response shapes. New mutations write only the audited records.

Ambiguous migrations pause the queue. The server does not choose between multiple live attempts.

Agent Shell shows Active or Inactive as lifecycle. It shows health and recovery as supporting detail.
