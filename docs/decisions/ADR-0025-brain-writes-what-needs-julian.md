# ADR-0025: Under a live brain, only the brain says what needs Julian

Amended by ADR-0027: the line shapes are Decide and Test, the clearing verbs are Accept and Reject.

Date: 2026-08-19

Status: accepted.

## Context

Agent Shell inferred what needs Julian from terminal panes: a static pane on a Goal meant "waiting for you". Under an Area brain (ADR-0024) that is wrong. A step that sits still waits for the brain to read its handover, not for Julian, so the list filled with rows he could do nothing about. The desk's answer so far was to hide the list for brain-run Areas, which left the brain with no way to say what it actually needs from him.

The design (`~/.tangent/trees/otto/tangent/design-what-needs-julian-under-brains.md`, solution `impl-what-needs-julian-under-brains.md`) set the yardstick: the actor that knows writes the list, every item is actionable in one step, each item says what it asks and what it unblocks, Julian answers where he reads, silence by default, items leave without his bookkeeping, a landed feature arrives on a server that already runs the new code, one place and one number, and it degrades to today's behavior without a brain.

## Decision

- The brain's plan Document is the only store. It writes a `## For Julian` section; `packages/agent-shell/app/for-julian.mjs` parses it. Three line shapes and nothing else: `- Decision [[<document>]]: <what it asks>. Unblocks: <what it unblocks>.`, `- Try it [[<goal-slug>]]: <where to go, what to press, what he sees>.`, and `- Brain: <one question that fits no Document>.` A line in any other shape is not shown. `brainPrompt` gives the shapes; `tangent brain status` prints what Tangent parsed, so the brain can check itself.
- `GET /api/sessions` and `GET /api/brains/show` carry the parsed rows on each brain as `forJulian`, resolved against the vault index, so a row shows the Document or Goal title and the Document's open comment count.
- The desk shows one amber card, `For you`. Its first groups are the brain-written rows, by Area, with `Reply to brain` in the group header. The inferred rows of Areas without a live brain follow, in today's wording. The Dock badge, the Work tab count, and the Area pill read that one list.
- Julian answers a Decision by commenting in the Document. A save that adds or changes a comment sends the brain one notice through the brain inbox, so the message survives a restart and a gap with no live brain. The brain acts, resolves the comments, and removes the line.
- Julian clears a Try it row himself with `Tried it` (`POST /api/brains/tried`, with `POST /api/brains/tried/undo` behind an undo toast). Those two endpoints are the only writes Tangent makes to the section. Rows never leave on a timer.
- A Try it line is only true when the running server already answers with the new code, so the brain runs `tangent shell rebuild` first: it rebuilds, restarts, and returns when the boot id changes.
- In an Area a live brain runs, Goal and step rows keep their state word as a fact, without amber, and no longer sort first. Areas without a live brain keep today's behavior everywhere.

## Consequences

- New module `packages/agent-shell/app/for-julian.mjs` with unit tests; new HTTP tests in `for-julian-http.test.mjs`; the desk card is covered in `focus-shell-ui.test.mjs`.
- New endpoints `POST /api/brains/tried` and `POST /api/brains/tried/undo`; `saveVaultDocument` gains one brain notice.
- New CLI noun `tangent shell rebuild`; `tangent brain status` ends with `Tangent shows N items for Julian` and the rows.
- The brain prompt's `launchctl kickstart` paragraph is gone: one command replaces the recipe.
- A row is only as good as the brain's line. Tangent never invents an item for Julian under a live brain, so a brain that writes nothing shows nothing.
