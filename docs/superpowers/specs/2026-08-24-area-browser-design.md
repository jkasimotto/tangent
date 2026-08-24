# Area browser redesign

Status: proposed

Date: 2026-08-24

## Problem

The Area browser currently spends its most prominent space explaining Areas, although the user has already chosen to browse them. After that interruption, the selected Area emphasizes a free-form graph and Programs. This makes the user's common jobs unnecessarily indirect:

- find an Area by typing;
- see work that exists but has not started;
- give new work to that Area's brain; and
- inspect a narrower, filterable set of Documents.

The root problem is not the wording of the hero. The screen has no single primary job. It combines Area selection, graph exploration, work dispatch, document browsing, Area administration, and Program administration without making the backlog the default.

The redesigned browser must make the unstarted-work inventory the dominant view. It must preserve access to the existing Document reader, Programs, Area administration, and graph where those remain useful. It must not introduce a second definition-agent lifecycle or change vault data.

Success is observable when:

- selecting **Browse Areas** immediately shows the Area browser with its search field focused;
- typing filters Areas without another click;
- selecting an Area first shows its not-started Goals;
- the primary new-work action opens or starts that Area's brain, without a Describe work form;
- Documents are a subordinate list that can be filtered by modified date and type;
- each type can be isolated or excluded without toggling every other type; and
- keyboard focus, loading, empty, and error states explain what happened and retain the selected Area and filters.

Non-goals are changing Goal status semantics, replacing the Document reader, removing Programs or Area administration, changing the vault schema, or redesigning the Work desk.

## Evidence

### Existing system

`renderWork` in [`packages/agent-shell/app/public/work-desk-view.js`](../../../packages/agent-shell/app/public/work-desk-view.js) already distinguishes **Current** work from **Planned** work. Planned Goal trees are those without a live session or a direct ask. Its **Browse Areas** action changes to the Areas view.

`renderAreas` and `areaContents` in [`packages/agent-shell/app/public/area-directory-view.js`](../../../packages/agent-shell/app/public/area-directory-view.js) render the large “Where work belongs” header, a collapsible Area tree, the selected Area's graph, Programs, and a **Describe work** action. There is no Area search field. The Area selection is persisted and ancestor rows are revealed.

The Area map projection already supplies Document kind and modified-time facts. Its stored state also contains type exclusions. The present type interaction is exclusion-only, which makes “show only designs” require excluding every other type.

Area brains already have start, resume, focus, return-point, and status behavior in the Work desk and Agent Shell. Describe work is a separate work-definition session and form. Reusing the brain avoids two competing places where an Area receives new work.

The Document reader is already the dominant reading surface and preserves its return point. The Area browser therefore needs a good document index, not another reader.

### Internal precedent

The Work desk provides the closest precedent for Goal grouping, planned-work classification, Area brain controls, and direct navigation. The existing Go to finder provides the closest precedent for focus-on-open, keyboard-first filtering, ranked matches, and empty results. The Document reader provides the return-to-origin behavior.

The accepted [`docs/design/agent-shell-area-desk.md`](../../design/agent-shell-area-desk.md) contract says Areas are the stable subject map, Documents are distinct product objects, and the user should reach an agent directly. This redesign keeps that model but gives the Area browser a narrower inventory job.

### External precedent

No external precedent is needed. The repository already contains coherent patterns for the affected interactions, and internal consistency is more valuable than importing a new browser convention.

### Implication

The change should compose existing projections and controls: the planned Goal-tree predicate, Area hierarchy and selection, Area brain actions, document metadata, and Document reader navigation. It should replace the hero and graph-first composition, not create new storage or a new work-definition agent.

## Principles

- **Inventory before topology.** The default Area view answers “what work exists and has not started?” before showing relationships among Documents.
- **One Area intake.** New work goes to the Area brain; the interface does not ask the user to choose between a brain and a definition session.
- **Filter by intent.** A type control must support both “only this” and “not this” directly.
- **Preserve place.** Area selection, query, filters, and reader return points survive navigation and refresh.
- **Keep unlike objects unlike.** Goals, Documents, Programs, and Area administration remain visually and structurally distinct.

## Recommendation

Replace the Areas page with a compact two-pane Area browser. Remove the hero entirely. The left pane begins at the top of the available content with a labelled search input, followed by the existing hierarchical Area rows. Opening the browser focuses and selects the search input. Typing filters by readable name and full path while retaining matching ancestors so hierarchy remains understandable. Arrow keys move through results; Enter selects; Escape clears the query first and then returns to Work.

The right pane is an Area workspace with this order:

1. a compact header with Area path, purpose/current note, brain state, and a primary **Open brain** or **Start brain** action;
2. **Not started** Goal trees, using the Work desk's planned-work classification and Goal row treatment;
3. **Documents**, as a filtered list with title, kind, relative modified time, and reader navigation;
4. collapsed **More** sections for the relationship map, Programs, and Area administration.

The brain action uses the existing Area brain lifecycle. If a brain is live, it focuses that session. If none exists, it starts one for the selected Area and opens it. The terminal is the place to describe the new work. The browser does not show the Describe work capture form and does not create a work-definition session.

The Document section has a text filter, a modified-date control, and type controls. Modified date offers **Any time**, **Today**, **7 days**, **30 days**, and **Oldest first** / **Newest first** ordering. Dates filter on the existing `changedAt`/`mtime` projection; they do not infer semantic freshness.

Each type is a split control. Selecting the type label means **Only this type** (exclude all others). Selecting its adjacent hide action means **Exclude this type**. The active state is written in accessible text and exposed with pressed state; it is not communicated by color alone. A **Reset** action restores all types. This directly supports both intents without modifier keys or repeated exclusions.

The Goal and Document sections have independent empty states. “No not-started work” does not imply the Area is empty. Loading keeps the selected Area header visible with section-level placeholders. A failed refresh keeps stale results visible, labels them as stale, and offers Retry. If the selected Area disappears, selection falls back to the nearest visible ancestor, then the first match.

Complete workflow: from Work, the user selects **Browse Areas** and types immediately. Matching Area rows narrow as they type. Enter selects an Area and moves focus to its **Not started** heading. They inspect an unstarted Goal or select **Start brain**, type the new assignment in the brain, then use Back to return to the same Area, query, filters, and scroll position. Selecting a Document opens the existing reader; Back restores the same browser state.

## Decisions

### 1. Make unstarted Goals the default, not the graph

**Recommendation:** show not-started Goal trees first and move the graph under a collapsed More section.

**Best rejected alternative:** improve the graph's filters and keep it dominant. This retains spatial relationships and minimizes structural change.

**Why:** the stated common job is inventory and dispatch. A graph optimizes relationship exploration, while a list gives complete titles, state, and predictable scanning. The existing Work projection already defines the needed subset. User impact is high and implementation coordination is moderate because the composition changes but the data contract does not.

**Reconsider when:** relationship navigation becomes the measured majority of Area visits or the list cannot represent an essential dependency decision.

### 2. Route new work directly to the Area brain

**Recommendation:** replace **Describe work** with **Start/Open brain** and use the existing brain lifecycle.

**Best rejected alternative:** retain the Describe work form but rename it. It captures a structured description before agent startup and preserves the current dedicated definition-run behavior.

**Why:** two intake agents make the user choose an internal orchestration mechanism before describing the work. The Area brain is already the durable planner for the subject and can decide whether to create, update, or dispatch Goals. Direct impact is high. Compatibility cost is limited to browser routing; the existing describe endpoints can remain temporarily for old sessions and deep return points.

**Reconsider when:** brain startup latency makes capture unreliable, or brains cannot safely accept unstructured work without losing the original text.

### 3. Use a focused persistent search field instead of a chooser screen

**Recommendation:** put Area search at the top of the left pane and autofocus it whenever Browse Areas opens.

**Best rejected alternative:** open a command-palette overlay for Area selection. It is compact and already familiar through Go to.

**Why:** Area browsing continues after selection; the hierarchy and selected workspace should remain visible. A persistent field supports rapid entry without turning the browser into a transient modal. User impact is medium; accessibility requires a visible label and predictable focus restoration.

**Reconsider when:** the Area count makes the persistent tree too expensive to render or nearly all Area navigation moves into the global Go to command.

### 4. Give each document type explicit Only and Exclude actions

**Recommendation:** use a split type control: label for Only, adjacent hide action for Exclude.

**Best rejected alternative:** a three-state chip cycling include, exclude, and neutral. It uses less space.

**Why:** cycling hides the available action and makes the current meaning harder to predict. Split controls expose both user intents in one step and remain keyboard-addressable. The UI cost is additional width, confined to the Document subsection.

**Reconsider when:** the number of discovered document kinds makes one control per kind unmanageable; then use a filter menu with explicit Only and Exclude commands per row.

### 5. Keep Programs and administration, but subordinate them

**Recommendation:** retain Programs, map, rename/move, nested Area, and completion controls under collapsed More sections.

**Best rejected alternative:** remove them from the Area browser and create separate destinations. That would make the primary screen cleaner.

**Why:** these actions are genuinely Area-scoped and already work. Removing them would create navigation and compatibility work unrelated to the requested hierarchy fix. Their lower frequency justifies progressive disclosure.

**Reconsider when:** a dedicated Programs or Area settings destination is restored as an accepted product contract.

## Risks / open questions

- The current “Planned” predicate includes Goals that may be waiting on dependencies, not merely ready to start. The heading must say **Not started**, and rows must retain dependency/blocking facts. If users need “ready now” rather than “no session,” add a separate readiness filter instead of silently changing the predicate.
- A brain might be stopped but have durable plan state. The existing brain lifecycle must decide whether **Start brain** resumes or creates; the browser must not implement a parallel rule. If that lifecycle cannot resume safely, the action needs distinct **Resume brain** copy.
- Dynamically discovered document kinds can make split controls wide. Start with the kinds present in the selected Area and move them into an explicit menu if more than six regularly occur.
- Removing the Describe work entry point can strand saved drafts or return points. Preserve recovery for an existing draft/session during compatibility cleanup, but do not present Describe work as the new intake path.
