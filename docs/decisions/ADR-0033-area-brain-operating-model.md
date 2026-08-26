# ADR-0033: Center Agent Shell on the logical Area brain

Date: 2026-08-26

Status: accepted

## Context

Agent Shell exposed runtime generations, separate approval flows, inferred attention, pipelines, and Programs as peer product concepts.
Brains also received large prompts but missed shared repository rules and recent Area work.

## Decision

Each exact Area has one logical brain identity. Runtime agent attempts remain internal diagnostics.

The vault owns Area facts, Journals, Goals, and Documents. A bound repository owns code-agent instructions and architecture records.
Agent Shell derives both inheritance stacks from their paths. Prompts contain bounded source references and hashes.

Requests are brain-authored conversation messages. Exact effects use immutable revisions. Free-text replies remain available.

One ordered assignment queue controls each Goal. A passing planned review closes routine work.

Programs project as Area Operations with one mode. Healthy Operations create no Work attention.

Legacy generations, Requests, inbox events, and pipeline records move to detached compressed audit exports after two stable release cycles.

## Consequences

Agent Shell gains one clear authority for each mutable fact. Capture survives a brain error because the Journal commit occurs first.
Prompt limits fail visibly and report omitted collections.

The browser and new clients use `/api/operations`. The old Program API requires `TANGENT_LEGACY_PROGRAM_API=1` during the two-release window.
The `tangent area audit` command is the only path to detached legacy records.

## 2026-08-27 implementation notes

One budget covers every generated character of a brain prompt. The checkpoint is generated text and sits inside it; only Julian's founding instruction sits outside. A prompt that cannot be built fails the brain start instead of starting a brain with no prompt.

Every stored line that reaches a bounded prompt is clipped where it is written. A Journal note, a Goal title, and a Question subject carry no length of their own.

Every Goal closure funnels through one milestone record, dropped Goals included. A one-time backfill dates existing closures by their Goal file.

`tangent goal list` stays exact by default and reports what its child Areas hold, with the command that reads them.

Work carries no attention strip, no Dock badge, and no inferred ask. A Question is a quiet count on its Area header and a deliberate review behind it. `ask-core.js` and `ask-dismissal-core.js` stay unreferenced for the two-release audit window; a governance lint refuses their return along with the strip, the badge, and the inferred-ask builders.

Only an Operation with a problem reaches Work. Healthy Operations stay on the Area page.

The Journal commit is a precondition, not an ordering. A capture the vault refuses records no milestone and wakes no brain; it reports `not-committed` and the words stay in the working tree. Exactly-once covers the whole Journal: an idempotency key stays used after a rollover moves its entry into an archive.
