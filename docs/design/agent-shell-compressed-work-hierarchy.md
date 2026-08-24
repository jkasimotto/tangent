# Compressed Work hierarchy

Status: accepted and implemented

Date: 2026-08-24

## Problem

The Work screen should answer two questions at a glance: what subject is work happening under, and what can Julian do next? The current screen exposes many implementation facts and repeated controls before it establishes that hierarchy.

In the observed Nira state, one Nira brain controls work in `nira/onboarding` and `nira/pg&e`, but the screen draws Onboarding and PG&E as unrelated peer cards. It then repeats the brain, Area state, work count, pipeline state, elapsed time, agent count, and several actions inside those cards. The result is visually dense but structurally weak.

The goal is a compressed Work view whose dominant structure is:

`brain-owned subject -> Area -> Goal -> active run or pipeline`

The screen must retain Browse Areas, text filtering, Current and Planned, active-brain access, the `Current work` count, direct access to a running step, elapsed minutes, and the ability to end work or close a Goal.

It does not need to preserve the present card layout or expose every available action persistently. This design does not change Area, Goal, brain, pipeline, or persistence semantics. It does not redesign the Area map, the For you queue, Goal details, Programs, or Describe work capture.

Success is observable when:

- Onboarding and PG&E appear under one Nira group while the Nira brain owns both.
- A user can scan the work titles, states, and ages without first parsing agent mechanics.
- Opening the current run remains a direct action; less frequent and consequential actions remain available within one additional interaction.
- Adding more brains creates more top-level groups rather than extending a horizontal brain strip.
- The wide view uses materially less height and chrome for the two-Goal state in the supplied screenshot.

## Evidence

### Existing system

The Work projection already derives its panels from the Area tree. [`area-map-core.js`](../../packages/agent-shell/app/public/area-map-core.js) chooses the first Area below the namespace as each panel root. [`work-desk-view.js`](../../packages/agent-shell/app/public/work-desk-view.js) then renders a heavy Area panel with an ordinal, ancestry, aggregate state, What happened, a brain button, section heading, Goal rows, and footer actions. Descendant work is already folded into an ancestor panel with a small provenance label, so hierarchical grouping is a projection rather than a persistence change.

The current Goal row separately renders pipeline position, context fill, state, elapsed-time bar, elapsed text, agent count, a primary run action, a pipeline picker, three fixed lifecycle controls, and conditional pipeline controls. The elapsed bar is scaled against the longest visible Goal. Its meaning therefore changes with the current result set, while the adjacent elapsed label is absolute.

The active-brain strip deliberately keeps every live brain accessible even when the Current/Planned filter has no matching Goal. It lays brain cards horizontally and repeats a brain button in any corresponding Area header.

### Internal precedent

[`ADR-0029`](../decisions/ADR-0029-brain-is-the-managed-work-controller.md) establishes the decisive hierarchy: one Area brain controls its Area and descendants, and active brain subtrees cannot overlap. This gives the Work projection an unambiguous, existing grouping boundary.

The accepted [Agent Shell area desk](agent-shell-area-desk.md) treats Area as the stable subject map, Goal as a row, Run as state plus a direct action, and the attention queue as an action index. It also says color must not carry meaning alone. The proposed design keeps those object distinctions but uses the controlling brain's Area as the top-level subject boundary when one exists.

The current descendant-work test proves that descendant Goals can be projected under an ancestor without creating another work container. The existing Goal/Subgoal disclosure also establishes progressive disclosure and connector-based hierarchy inside a flat row layout.

### External precedent

The prior area-desk design already records the relevant precedent: Linear gives a stable subject a home while keeping work objects distinct, and GitHub Projects permits different projections over the same work. No new external interaction pattern is required here; internal consistency is stronger evidence.

### Implication

Use the existing Area paths, active-brain ownership rule, Goal trees, and pipeline records. Replace the panel-selection policy and visual projection only. Do not store a new “Nira group,” duplicate ownership state, or infer hierarchy from session names.

## Principles

1. **Hierarchy before telemetry.** Brain-owned subject, Area, and Goal names establish where work belongs. Runtime facts are secondary.
2. **Show facts only when they change a decision.** Absolute elapsed time helps identify an unexpectedly long run; a relative bar without a stable baseline does not.
3. **One persistent route per common intent.** Opening active work is common and direct. Editing pipeline configuration and ending or closing work can share progressive disclosure.
4. **Counts summarize children, not machinery.** A group may say `2 working`; individual rows still use state words, but neither repeats agent counts when one Goal has one visible active step.
5. **Flat rows inside shallow groups.** Use type, spacing, and a single guide line to express nesting. Do not create cards inside cards.

## Recommendation

Render Work as a single-column list of **work groups**. A live brain's Area is the root of one group and owns every visible descendant Area in its controlled subtree. Work not covered by a live brain falls back to the existing durable-subject root rule. Because active brain subtrees cannot overlap, each visible item has exactly one group.

The supplied state becomes:

```text
Browse Areas   Filter work and Areas…                  Current | Planned

Nira                                      2 working      Open brain →
│
├─ Onboarding                              Current work 1
│  Design the embedded-js onboarding walkthrough app
│  Working · 13m                                      Open ▾
│
└─ PG&E                                    Current work 1
   Autodesign
   Explain the autodesign system (Dart + dim)
   Working · 13m                                      Open ▾
```

`Nira` is a quiet group heading, not another large card. It carries one aggregate count and the direct brain action. Each child Area is a compact section with its name and `Current work N` (or `Planned work N`). A deeper descendant can show the shortest path needed to distinguish it, but nesting never creates another bordered container. Goals remain flat rows. Root Goal/Subgoal hierarchy keeps the existing disclosure pattern.

The group heading replaces both the Active brains strip and per-Area brain icons. Multiple brains produce multiple vertically stacked groups in stable Area-path order. A live brain with no matching Goal still renders as a collapsed one-line group, preserving the existing invariant that every live brain remains one click away under either filter.

Each Goal shows only:

- full Goal title;
- explicit state word (`Working`, `Waiting`, `Stopped`, `Ready`, or `Complete`);
- absolute elapsed time when a run has started;
- one contextual split action.

Remove the relative elapsed bar, agent count, standalone `Step N of M`, and carried-context fill from the default row. The primary half of the split action opens the current run. Its label is `Open` for a one-step pipeline and `Open step N` for a multi-step pipeline. The menu exposes other pipeline steps and configuration first, then currently valid run/Goal actions in a separated danger section: Restart, Skip/Send to next when applicable, End work, Won't do, and Done. Consequential actions retain their existing confirmation or undo behavior. Disabled actions are omitted from the menu and explained only when their absence would otherwise be surprising.

Remove the Area ordinal, parent breadcrumb when the group already supplies it, aggregate “N agents working” state, What happened, brain icon, Describe work here, and Organize Area from Work. Browse Areas remains the route for organization. Describe work remains available from the dedicated capture surface rather than being repeated on every visible Area. Historical work remains available through the Area map instead of a per-card What happened control.

Filtering preserves group context: matches keep their owning group and Area label visible. Current and Planned remain projections, not stored states. Empty groups disappear unless they contain a live brain; a brain-only group stays as the compact line described above. Loading should preserve the toolbar and use stable skeleton rows. A partial runtime failure should still show vault Goals with runtime state marked `Unavailable`, without inventing `Ready` or zero elapsed time.

Keyboard and accessibility behavior follows the existing controls. Group and Area names are headings in a valid order. The split button has separate accessible names for opening and showing actions. Menus support arrow keys, Escape, focus return, and do not rely on color. The aggregate state remains text even when accompanied by the existing blue or amber marker.

## Decisions

### 1. Group by the controlling brain's Area, with durable-subject fallback

**Recommend:** make the nearest live controlling brain Area the group root. Fall back to the existing durable-subject root for uncovered work.

**Best alternative:** always group by namespace root, such as Nira. This is visually stable and would produce the requested screenshot even when no brain exists.

The rejected alternative hides meaningful ownership when a namespace contains several non-overlapping brains. Brain ownership is already exclusive, runtime-authoritative, and directly matches the user's mental model in this case. The fallback prevents the layout from collapsing when no brain runs. This is a private browser projection with no compatibility or persistence cost, but it changes spatial grouping when brains start or end. Reconsider if brain churn makes groups move often enough to disrupt scanning; in that case use the stable namespace root and show brains as secondary group labels.

### 2. Replace the Active brains strip with group headings

**Recommend:** make each brain the accessible heading/action for its work group and retain an empty compact group when it has no matching work.

**Best alternative:** keep a compact horizontal brain roster above the work list. It guarantees a fixed place for all brains and avoids brain accessibility depending on work rendering.

The roster duplicates the same ownership label and scales sideways as brains increase. Integrating brain access with its controlled work makes the relationship legible and scales vertically. The cost is a deliberate departure from the current “independent of filter” strip, addressed by retaining brain-only groups. Reconsider if brains need cross-Area controls or comparison that cannot fit in a group heading.

### 3. Use absolute elapsed text and remove the bar

**Recommend:** show `13m`, `2h`, or `3d` beside state and remove the bar.

**Best alternative:** retain a bar with a fixed, documented scale. A bar can make unusually long work visually pre-attentive.

The present bar is relative to the longest visible Goal, so the same run changes length when filtering or when another run starts. It adds ink without a stable interpretation, while exact elapsed text already exists. This is presentation-only. Reconsider when the product has a meaningful target duration or historical baseline; then a bar can encode progress against that stable reference.

### 4. One contextual action menu, with Open remaining direct

**Recommend:** use a split action: direct Open plus one menu containing pipeline navigation/configuration and valid lifecycle actions.

**Best alternative:** keep Done permanently visible and place only rare actions in overflow. Done is an important terminal action and a fixed target can reduce interaction cost.

Most visible rows are active work, where opening the agent is frequent and closing the Goal is consequential. One additional interaction for Done is a favorable trade for removing repeated action noise and reducing accidental closure. Confirmation/undo remains mandatory where it exists today. Reconsider if usage evidence shows Done is performed from Work nearly as often as Open, or if the extra menu measurably leaves finished Goals open.

### 5. Remove Area-local utility actions from Work

**Recommend:** remove What happened, the Area brain icon, Describe work here, Organize Area, ordinals, and redundant ancestry/state text.

**Best alternative:** place all of them in one Area overflow menu. This preserves discoverability without persistent visual weight.

Browse Areas already supplies the organization route; the group heading supplies brain access; history belongs to the Area map; and repeated capture controls are not part of scanning current work. An overflow would still make Work an undocumented secondary navigation surface. Reconsider only if removing an action leaves no discoverable route in Browse Areas or the dedicated capture flow.

## Risks / open questions

- **Brain lifecycle can move groups.** A brain starting at Nira can merge previously separate durable-subject groups; ending it can split them. If this occurs frequently in ordinary use, stable namespace grouping should replace brain-root grouping while ownership remains visible inside it.
- **Action-menu discoverability is unproven.** The recommendation assumes Open dominates row interaction. Instrument or observe Open, Done, End, and pipeline-control use. If Done is comparably frequent, restore it as the sole persistent secondary action.
- **Describe work route must remain discoverable.** Removing the repeated footer is safe only if the existing dedicated capture entry is visible from Work or Browse Areas. If it is not, retain one page-level `Describe work` action rather than one per Area.
- **Programs can break the compressed grammar.** Programs currently occupy Area cards. This design leaves their product behavior unchanged but does not place them in the new work group. If Programs must remain on Work, they need a separate compact shelf rather than Goal-like rows; otherwise they should remain in the Area surface.
