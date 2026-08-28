# Implement remembered brain turns and Root orientation

Repository: `/Users/julianotto/Projects/otto-tangent`

Read these sources before you change code:

1. [Product design](/Users/julianotto/.tangent/trees/otto/tangent/design-agent-shell-work-briefing.md)
2. [Engineering record](./design-record.md)
3. The applicable `AGENTS.md` files.

The product design is settled. The technical capture mechanism is not settled.

Do not stop after another product proposal. Investigate the current system, make the technical decisions, implement them, and prove the result.

## Product outcome

A user talks to an Area brain through the normal brain terminal.

The phrase **“remember this”** marks the complete current user turn for durable storage.

Tangent saves the exact submitted text. The saved text includes the cue, line breaks, repetition, and uncertainty.

The brain then responds as normal. There is no Spew button, composer, mode, or separate briefing screen.

A fresh brain can later use these remembered turns to answer “orient me” in normal conversation.

## Storage contract

Use the existing Journal Markdown format and archive behavior.

Store complete Root turns here:

`~/.tangent/trees/journal.md`

Store complete Area turns here:

`~/.tangent/trees/<area>/journal.md`

Examples:

- Neara: `~/.tangent/trees/neara/journal.md`
- Tangent: `~/.tangent/trees/otto/tangent/journal.md`

The source Journal entry is canonical.

Each entry needs a stable identifier. Use this identifier for retry protection and route provenance.

The Journal body must contain the native user text. Never use model-generated text as the canonical copy.

For voice input, save the transcript that the agent received. Do not claim fidelity to the source audio.

Commit the Journal write before the brain reports success. Report a clear error after an unsuccessful save.

## Root contract

Show Root before the current top-level Areas.

Root represents the vault root at `~/.tangent/trees/`.

Do not create a `root/` folder. Do not move Neara, Otto, or any current Area.

Root has a normal Area brain and can read the complete Area tree.

Design a safe Root identity for APIs that currently require a nonempty Area path.

## Routing contract

Keep the complete remembered turn in its source Journal.

The brain can propose an exact excerpt for another Area. The user approves that route through normal conversation.

Write the exact approved excerpt to the destination Journal. Add the source entry identifier to the routed entry.

Do not add a route picker or batch interface.

A route stores context only. It does not create a Goal, change priority, or authorize work.

Preserve the current protected `route-journal` behavior. Extend it instead of creating a second routing system.

## Memory boundaries

A Journal answers: “What did Julian say, and how did his view change?”

An Area note answers: “What is true and current for this Area?”

A Goal answers: “Which result is wanted, and what is its state?”

Do not treat every saved sentence as a command or current fact.

Preserve the existing conclusion-memory behavior. The raw Journal capture happens before a derived update.

Corrections become later Journal entries. Do not rewrite an earlier entry.

Do not save every user turn. An explicit save request is required.

## Technical gate

Agent Shell currently transports terminal bytes through xterm. It does not expose a simple semantic user-turn event.

Find a reliable source for these values:

- The exact submitted user text.
- The complete user-turn boundary.
- A stable native message identifier.
- The Area brain that received the turn.
- The explicit save request.

Do not reconstruct canonical text from model output.

Do not claim exact capture from raw keystrokes without proof for paste, editing, multiline input, and terminal controls.

Use the Usage API or provider transcript support where it fits. Do not grep native transcript files.

Document the selected capture path and its guarantees in the engineering record.

## Orientation behavior

A fresh brain must read remembered turns in its scope.

Root reads the complete tree. A smaller Area brain reads its subtree and relevant routed entries.

The answer starts with the last meaningful user view. It then explains material changes and the next decision.

The brain distinguishes these sources:

- “You said…” for remembered user text.
- “The records show…” for current facts and activity.
- “My read is…” for agent interpretation.

Time spent shows attention. It does not prove priority.

Keep orientation in text for this implementation. Do not add A2UI or another generated UI system.

## Required tests

Add tests for these cases:

1. “Remember this” saves the complete native user turn.
2. The saved body preserves the cue and line breaks.
3. An unmarked turn creates no Journal entry.
4. Root writes to `~/.tangent/trees/journal.md`.
5. An Area writes to its existing Area folder.
6. A retry creates no duplicate entry.
7. An unsuccessful commit produces no success receipt.
8. A routed excerpt matches the source text.
9. A routed entry names its source entry identifier.
10. A declined route creates no destination entry.
11. Root appears without moving current Area paths.
12. A fresh brain can use Journal memory for orientation.
13. Existing Capture note, Journal archive, and remember behavior still work.

Add integration coverage for the production path. Do not prove this feature only through isolated helper tests.

## Working-tree safety

Other agents can have active changes in this checkout.

Inspect `git status` before each edit and before each commit.

Preserve all unrelated changes. Stage only the files and hunks that you own.

Do not create a worktree unless Julian asks for one.

Update the architecture documents and governance rules after an architecture change.

Commit your changes atomically on the current branch.

## Validation

Run these commands:

- `npm run check`
- `npm run test`
- `npm run governance`
- `npm run build`

Before you start Agent Shell, run `tangent service list`.

Use the registered service through `tangent service start <name>`.

Exercise the visible Root and remembered-turn flow against the real Agent Shell.

## Done condition

The work is done after all these statements are true:

- Root is usable from Agent Shell.
- “Remember this” works inside normal brain conversation.
- Tangent saves the exact complete turn to the correct Journal.
- The implementation provides retry safety and honest error reporting.
- Exact approved excerpts can reach another Area with source provenance.
- A fresh brain can use the saved perspective during orientation.
- No new Spew or briefing interface exists.
- All required tests and repository validation commands pass.

At completion, report the technical decision, changed files, user-visible behavior, test evidence, and commit.
