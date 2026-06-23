# Design: outcomes checklist at task start

Status: proposed (2026-06-24). Source: in-app feedback `1782252257380`.

## The ask, reframed

> "I actually would like to remove 'What you are working on' and instead just list multiple outcomes when starting a task. A list of outcomes helps me more precisely focus AND quantify what I want to get done this session."

Surface request: drop the free-text intent field, capture a list of outcomes instead.

Real need: at task start the user wants to **pre-commit to a concrete, checkable set of deliverables** so they can (a) focus more sharply on results rather than an activity, (b) define what "done" means up front, and (c) measure not only time-vs-estimate but **scope-vs-actual** (did I finish what I set out to do?).

"What you're working on" describes an activity ("refactoring the parser"); an outcome describes a result ("parser handles nested formulas", "legacy path removed", "tests green"). A list of results is both a sharper pre-commitment and a natural progress checklist. The single optional `outcome` field today is a weaker version of exactly this.

## Current model (what we change)

- `task_started` event: `{ entity, intent, outcome?, estimateMin }` (`focus-client.ts:8`).
- `Task`: `intent` is the focus heading (`App.svelte:585`), `outcome?` renders as a faint "predict:" line (`App.svelte:613`).
- Bet result: `predicted {outcome||intent} in {est} · took {actual} · {verdict}` (`App.svelte:285`).
- Rollup heading: `## {intent} -> {outcome}` (`App.svelte:206`).
- The event log is the single source of truth; `Task` is a pure projection (`projectFocus`, `focus-client.ts:62`). Nothing is mutated in place, so adding outcomes means adding event shapes, not migrating rows.

## Proposed model

### Schema
- `task_started` gains `outcomes?: { id: string; text: string }[]`. Keep `intent`/`outcome` optional for backward compatibility.
- New event `outcome_checked: { ts; taskId; outcomeId; done: boolean }` — checking an outcome off (and unchecking) during the session.
- `Task` gains `outcomes: { id: string; text: string; doneAt?: number }[]`. Legacy tasks (intent + optional outcome, no `outcomes[]`) project into a single synthesized outcome from `outcome ?? intent`, so the old log keeps rendering without a rewrite.
- Derived display title (for rollup, bet, incoming list) = first outcome text, falling back to legacy `intent`.

### Start form
Single column:
1. `entity` (unchanged, autocomplete).
2. **Outcomes editor**: one text input; Enter adds the typed outcome as a line and clears the input for the next; each line shows with a remove (×); Backspace on an empty input removes the last line. At least one outcome required.
3. `estimate min` + `Start`. `startReady` = entity set AND ≥1 outcome AND estimate > 0.

Form submits only via Start or Cmd+Enter, so Enter-to-add-outcome never fires the task early (mirrors the note composer at `App.svelte:622`).

### Focus view
- Eyebrow: entity. No separate activity title.
- Body: the outcomes as a **checklist** (the dominant focal element). Tapping an item toggles `outcome_checked`. Completed items read as struck/dimmed.
- Clock chip unchanged (one session estimate). Add a small "M/N done" beside it so progress is legible at a glance.

### Bet result and rollup
- Bet: `predicted {N} outcomes in {est} · completed {M}/{N} · took {actual} · {verdict}`. `verdict` still compares actual vs estimate; `M/N` exposes scope-vs-actual.
- Rollup: list each outcome with `[x]`/`[ ]`, then notes, then done note.

## Decisions to confirm (genuine forks)

1. **Scope: checkable vs static.** Recommended: outcomes are checkable live (`outcome_checked` event, "M/N done", richer bet). This is what makes the feature worth more than today's single predict line and directly serves "quantify what I want to get done." Cheaper alternative: a static list (no new event, no toggling) — a nicer predict line but no progress signal.
2. **Estimate granularity.** Recommended: one session estimate (keep `estimateMin`). Per-outcome estimates add real input friction at the moment you most want to just go, and per-outcome *actuals* are not derivable from wall-clock (focus segments are per task, not per outcome), so per-outcome estimate-vs-actual cannot be measured without per-outcome completion timing. Checkoffs give the scope signal more cheaply.
3. **Focus heading.** Recommended: entity as eyebrow + outcomes checklist as the body, no separate title. Alternative: lead with the first outcome as the h1 and list the rest beneath.

## Why this fits the UX guidance
- Recognition over recall and visible state: the checklist is the session's intent made visible and trackable, not a remembered plan.
- One dominant focal point: the checklist is the focus body; entity and clock are supporting metadata.
- Reduce input load: chip/line entry is a known low-friction pattern; one estimate keeps the start fast; per-outcome detail is deferred.
- Make state legible after action: checking an outcome updates "M/N done" immediately; the bet closes the loop on scope and time together.
