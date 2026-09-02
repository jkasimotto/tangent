# First-class Area resources on the Map

- **Status:** Product design complete
- **Date:** 2026-09-02
- **Scope:** The Map experience for Area worktrees, repositories, and links

## Decision summary

**Decision:** A worktree, repository, or link can be a first-class Area resource. A Tangent Block represents that resource on the Map.

The design keeps the established word **Block** in the interface. This record uses **Map entity** for a Block with a semantic source and action.

**Decision:** A worktree or repository Block has **Copy path** as its primary action. A link Block has **Open** as its primary action.

**Decision:** A Resources panel shows the resources for one explicit Area. It supports discovery, addition, management, and deliberate placement on the Map.

**Decision:** Resource discovery never adds or places a Block. Julian keeps authority over Map representation, position, size, connections, and style.

**Decision:** External state uses the provider's words. `Accepted` and `Merged` get a green success treatment, a check mark, and visible state text.

**Decision:** State refresh changes system-owned facts only. It does not change Map geometry, authored style, selection, camera, save state, or undo history.

**Decision:** This record defines the product contract for durable Area membership. It does not select its storage, API, or provider integration.

## Problem contract

### Person and intent

**Observed:** Julian repeatedly enters Area worktrees to inspect code. The path is not available as a direct action in the current browser experience.

**Observed:** Julian currently asks a Brain to copy a worktree path with `pbcopy`. This adds a conversation round trip to a local navigation task.

Julian needs to recognize the correct worktree, copy its exact path, and continue in his chosen tool. He must not need Brain mediation.

Areas can use multiple worktrees. A single Area folder or one inherited launch folder does not describe this working set.

Links have the same core need. Julian must recognize the target, see important state, and open it without leaving the Map context first.

### Blocked outcome

The current product does not put actionable Area targets where Julian navigates his work. It also does not distinguish multiple worktrees on one Area.

The problem is not a missing `pbcopy` command. The problem is a missing durable, visible, and actionable relationship between an Area and its resources.

### Observable success

The design succeeds when all of these statements are true:

- Julian can find every catalog worktree and exact legacy Worktree declaration for an Area from the Map.
- Julian can distinguish worktrees by label, branch, repository, and path.
- One Enter press or one visible pointer action copies the selected worktree path.
- A double-click performs the same primary action.
- A copied path is absolute, has no trailing newline, and matches the path shown in resource details.
- Julian can open an Area link with the same action grammar.
- A Phabricator revision with `Accepted` state becomes visibly green.
- A GitHub pull request with `Merged` state becomes visibly green.
- State remains understandable without color.
- Discovery never moves, places, removes, or restyles a Block.
- Copying or opening a target does not dirty the Map.
- Multiple worktrees remain usable at 800 px and with keyboard or screen-reader navigation.
- Missing, stale, blocked, and unavailable targets keep a useful recovery action.

## Product constraints

### Existing authority rules

**Observed:** One composed Map world owns selection, history, loading, conflicts, drafts, and camera state. Focus and fold are view masks.

**Observed:** A Tangent Block stores a semantic kind and source reference. Source facts can refresh without changing user-owned geometry or style.

**Observed:** Julian places Map Blocks. A Brain can propose a Block, but it cannot place or move one.

**Observed:** The Map is the durable home, and Work is a temporary lens. The narrow split retains hidden Map or Brain state.

These rules continue to apply to resource Blocks.

### Area resource authority

**Observed:** The current launch resolver parses one `Repository`, `Worktree`, and `Branch` from a legacy `## Resources` section.

**Observed:** The later Area-note decision rejects a machine-owned Resources section. It puts multiple free-form resource facts under `## Knowledge`.

**Observed:** Tangent does not write Area-note prose. A Brain or a person maintains the note.

**Observed:** Goal attempts can use explicit folders that are not the Area launch folder. These folders are attempt data, not Area membership.

**Decision:** A first-class Area resource catalog is authoritative for actionable Map targets.

Julian's explicit **Add**, **Edit**, **Replace target**, **Add to this Area**, and **Remove from Area** actions change this catalog.

Discovery, Agent Attempts, Brain context, and Area Knowledge can propose targets. They cannot change catalog membership without Julian's explicit action.

The catalog does not rewrite or parse arbitrary Area prose as confirmed membership. Area Knowledge stays free-form and machine-untouched.

This decision narrows the later Knowledge rule for actionable Map targets. Knowledge can describe them, but the catalog supplies their product identity and action.

This design supersedes only ADR-0049 line 25's plain-text fact-authority clause for catalog-backed resource Blocks.

The catalog is their fact authority. ADR-0049 geometry, style, placement, and existing record-authority rules remain unchanged.

The Brain receives Area Knowledge and a separate **Map resources** list. `tangent area show` presents that same list with source-Area provenance.

The catalog remains separate from the launch-folder binding. Catalog changes never change where workers start.

A later code design must choose the catalog storage, API, status integration, and compatibility mechanism. It must not reopen this product authority rule.

### Existing resource migration

**Decision:** The first catalog load offers a reviewed import for exact legacy `Repository` and `Worktree` declarations.

The panel lists these declarations under **Legacy resources to review**. Each row shows kind, path, source Area, and **Copy path**.

Julian selects rows and uses **Import selected**. No catalog membership changes before this explicit confirmation.

The declaring Area owns each confirmed import. A descendant sees it as inherited from that Area.

The import leaves Area prose unchanged. It also leaves the launch-folder binding unchanged and does not place a Block.

Imported rows show **Imported from legacy Area binding** until Julian edits them.

Duplicate exact targets of the same kind become one direct resource. Cross-kind declarations import separately and show the cross-kind warning.

A legacy `Branch` value becomes metadata only when its declaring note identifies one matching local target.

If more than one target can match, the panel shows **Choose a resource for branch _name_.** It does not guess.

Paths and URLs in free-form Knowledge become Suggestions only. The product shows the source line and requires **Add to Area**.

**Not now** leaves the legacy rows available for later review. It does not convert them into an empty state.

Import is atomic and repeatable. If any selected row fails, no selected row imports, and the panel keeps the review with **Retry**.

Existing same-kind catalog targets show **Already a Map resource** and do not duplicate. Cross-kind targets import as separate associations with a warning.

After review, note edits do not silently change the catalog. A newly recognized or changed target appears as a Suggestion with Knowledge provenance.

Existing generic URL Blocks remain Map-only. **Add to Area** can associate one with its owning Area without moving or restyling it.

### Scope of the entity concept

**Decision:** The first product kinds are `Worktree`, `Repository`, and `Link`.

A GitHub pull request and a Phabricator revision are provider-specific Link kinds. Their primary action remains **Open**.

**Proposed generalization:** These kinds share one product shape: Area ownership, target, state, and one safe primary action.

**Decision:** A branch is metadata for a Repository or Worktree in this scope. Tangent does not give it an independent Map action.

A command has different permission, progress, and recovery rules. It is outside this resource design and remains an Area Operation.

A skill remains an agent resource. It does not become a Map Block.

A repository file remains a Document only after the existing safe Document path accepts it. This design does not add a file browser.

## Current experience audit

| Surface | Observed behavior | Product consequence |
|---|---|---|
| Area binding | The parser returns singular repository, worktree, and branch values. Nearest declarations can come from different Areas. | It selects a launch folder but cannot represent a working set. |
| Area browser | The Area page has no worktree or link resource section. | Julian cannot copy a path from the browser. |
| Map picker | `B` offers Goals, Documents, Areas, and HTTP links. It does not index local worktree or repository paths. | A worktree cannot become a source-backed Block. |
| Link Block | A link shows its host and URL. It has no provider state or freshness. | A review cannot show `Accepted`, `Merged`, or stale state. |
| Document Block | Enter opens the object. Selection alone performs no action and does not write the Map. | Resource Blocks can reuse semantic dispatch safely. |
| Selection | A single click selects. Enter and double-click perform the primary action. `X` hides a Block. | A single click must remain a selection action on the canvas. |
| Multiple selection | Current action resolution can use the first semantic Block. | The resource action needs an exact single-selection rule. |
| Keyboard | The Map owns keys only when text input, a dialog, or another context does not own them. | Resource actions must not leak into typing or dialogs. |
| Clipboard and links | Work cards announce copy errors and blocked link opens. Map links do not report blocked opens. | The Map can reuse the stronger Work feedback. |
| Outline | The current Outline lists Areas but not Blocks. | Canvas entities lack an equivalent accessible list. |
| Narrow layout | At 800 px, hidden Map or Brain panes remain mounted and inert. Work retains the Map under its temporary lens. | Resource management must preserve both retention rules. |
| Load and save | The Map shows loading, retry, `Ready`, `Last known`, `Saved`, `Not saved`, and conflict recovery. | Resource state must not replace these Map-level states. |
| Missing source | A missing source becomes a dashed `gone` Block and keeps its geometry. | Resource removal must not erase spatial context. |

### Closest internal precedents

The existing Tangent Block is the primary precedent. It already connects Excalidraw layout with a semantic source and dispatch action.

Brain-presented cards are the action precedent. They use **Copied**, **Could not copy**, new-tab links, and clickable Phabricator reviews.

**Observed (historical):** The superseded JSON Canvas Map had an Inbox with an explicit **Place** action.

Only its separation between discovery and placement remains relevant. This design does not restore that Inbox or its old canvas authority.

The current save and runtime labels are the state precedent. They preserve last-known truth and put recovery next to the affected surface.

**Decision:** These precedents apply together. A parallel worktree widget splits selection, keyboard, accessibility, and Map authority.

## Candidates

### Candidate A: Place every discovered resource automatically

The Map shows all paths and links as soon as the system finds them.

This candidate has low placement effort. It creates clutter, false Area associations, and unexpected layout changes.

Real repositories can have unrelated worktrees. An attempt folder can be temporary. A discovered URL can be contextual evidence, not an Area resource.

**Rejected:** Automatic placement violates Julian's Map authority and makes discovery look like confirmed membership.

### Candidate B: Add resource kinds only to the Block picker

Julian searches for a resource with `B` and places it like any other Block.

This candidate preserves the Map grammar. It does not explain missing resources, inheritance, duplicates, stale paths, or multiple-worktree management.

**Rejected:** The picker is good for placement, but it is not a resource inventory or management surface.

### Candidate C: Add a resource widget outside the Block system

The Map shows special worktree and review widgets with separate actions.

This candidate can optimize each type. It duplicates selection, focus, keyboard, responsive, and accessibility behavior.

**Rejected:** A second entity system makes the Map less coherent and weakens the existing Tangent Block contract.

### Candidate D: Use an Area Resources panel and explicit Block placement

The panel owns discovery and management. The existing Block system owns placement, selection, actions, and spatial relationships.

This candidate adds one persistent concept, **Resources**, and reuses the existing Map grammar. It keeps discovery separate from Map mutation.

| Criterion | A: Auto-place | B: Picker only | C: New widget | D: Panel plus Block |
|---|---|---|---|---|
| Explicit membership | Discovery implies membership | Placement implies membership | Separate widget can confirm it | Add confirms it before placement |
| Discovery and management | No review step | Search only | Full but separate | Full and Area-scoped |
| Map authority | Fails | Preserves | Preserves | Preserves |
| Action grammar | Reuses Block | Reuses Block | Adds another grammar | Reuses Block |
| Narrow and accessibility | Creates unbounded clutter | Omits inventory recovery | Duplicates focus and key rules | Uses one sheet and Outline |
| Error recovery | Ambiguous source errors | Picker errors only | Separate recovery model | Local panel and action recovery |

**Selected:** Candidate D preserves context and prevents false membership. It also reuses the existing action and accessibility contracts.

## Product model and language

### Resource membership

An Area resource is an actionable target that one Area records for continued use.

First-class membership is not canvas-only data. The Resources panel, Block picker, Outline, Area context, and Brain context use the same association.

Map placement remains separate from membership. Adding a resource does not create a Block or send a Brain message.

Each resource has these user-visible facts:

- The owning Area.
- A kind: Worktree, Repository, or Link.
- A label.
- An exact target.
- Optional metadata, such as branch, repository, provider, or review number.
- Target state and freshness.
- One primary action.

**Decision:** Direct membership belongs to one exact Area. Descendants can see inherited resources with their source Area.

An inherited resource remains owned by its source Area. A descendant cannot rename or remove it.

If the target has direct meaning for a descendant, Julian can use **Add to this Area**. This creates an explicit descendant association.

The same target can belong to different Areas. The Resources panel warns about duplicate targets inside one Area.

### Resource identity and duplicates

**Decision:** One direct Area association is one product identity. Its Map representation state is local to that owning Area.

Renaming a resource or replacing its target keeps the identity. Existing Blocks update their facts and action target without moving.

Removing the association ends that identity. Its existing Blocks become `gone` and do not attach to a later same-target resource automatically.

The same target can have one direct association in each relevant Area. Each Area can place its own Block in its own scene.

Inside one Area, the same kind and exact normalized target can have only one direct association. The panel locates that resource instead of adding another.

Path normalization expands the home folder and removes redundant or trailing separators. It does not resolve symlinks or change letter case.

If different path text appears to reach the same folder, the panel warns and lets Julian keep both. This rule preserves intentional aliases.

The same exact target with different kinds is allowed with a warning. A main checkout can be both a Repository and a Worktree.

URL duplicates use the exact recorded HTTP or HTTPS target after host-name case normalization. Redirects do not merge resource identities.

### Labels for multiple worktrees

Julian can give each worktree a short label. The product uses this fallback order when no label exists:

1. The branch name.
2. The final folder name.
3. A shortened path.

The row always makes the branch and folder distinguishable. If two rows still look equal, both rows show more of their paths.

The panel marks the current launch folder with **Workers start here by default** when it matches a resource.

This badge is information only. Changing the launch folder is outside this design.

### Block content

A resource Block shows information in this order:

1. The kind, such as **WORKTREE**, **GITHUB PR**, or **PHABRICATOR REVISION**.
2. The resource label.
3. A short target clue, such as branch, folder, host, or review number.
4. Exceptional state, such as **Missing**, **Last known**, **Accepted**, or **Merged**.

The Map does not show a full long path by default. The selected action and Resources panel show the exact target.

The accessible name includes the kind, label, state, owning Area, and exact target.

## Area Resources panel

### Entry and scope

The Map toolbar has a visible **Resources** action. The panel heading qualifies the surface, such as **Map resources · Tangent**.

The qualifier makes the scope clear. The panel lists actionable Map targets, not every skill, command, environment, or Knowledge fact.

The panel resolves its Area in this order:

1. The owning Area of exactly one selected Block.
2. The selected Area.
3. The last Area that Julian explicitly located through Find, Outline, or its label.
4. The stored Area for the Map.

If no Area resolves, **Resources** asks Julian to choose a visible Area. It does not invent an `@root` resource owner.

If multiple selected items have different owners, the panel asks for one Area before it enables a change.

An Area breadcrumb lets Julian move to a parent or child Area. The scope remains visible during every add, edit, and place action.

**Decision:** The Map owns resource management. An Area page can show a resource count and **Open Map resources**.

The Area page does not add a second resource editor. This rule prevents two interaction models and two stale drafts.

The count includes direct and inherited catalog entries. A separate suggestion count never inflates confirmed membership.

### Inventory

The panel groups rows in this order:

1. Direct Worktrees and Repositories.
2. Direct Links.
3. Resources from ancestor Areas.
4. Suggestions.

Within each direct group, **Workers start here by default** comes first. On-Map resources come next, followed by alphabetical labels.

Each row shows its label, kind, target clue, state, source Area, and Map representation.

Each recorded row also has its primary **Copy path** or **Open** action. Julian can use a resource before he places its Block.

Map state uses **On Map**, **Not on Map · Never placed**, or **Not on Map · Hidden**.

At most one live Block can represent one Area-resource association. A hidden placement record does not count as a live Block.

### Resource details

Every recorded row and selected resource Block has a visible **Details** action. Worktree and Repository Blocks do not assign `o` to this action.

Details shows the exact selectable target, owning Area, source Area, kind, branch, provider state, freshness time, and Map state.

It also shows **Workers start here by default** when the launch binding matches. An explicit Goal path can still take precedence.

At wide widths, Details expands inside the Resources panel. At narrow widths, it opens a named view inside the Resources sheet.

**Back** and Escape return to the prior resource row. Both controls restore the exact Details opener.

The selected Block action opens the Resources panel in the correct Area and focuses its Details view.

### Discovery

Catalog loading and discovery are separate operations. Opening the panel loads confirmed direct and inherited resources without scanning Git.

The visible **Discover worktrees** action searches these bounded sources:

- Worktrees of recorded repository targets.
- Working folders from the latest 20 Agent Attempts in this Area, limited to the last 30 days.

Changed Knowledge targets can also appear as Suggestions during catalog load. They show the exact source line and never become confirmed automatically.

Discovery does not scan unrelated folders. Each result explains its evidence, such as **Used by Goal X** or **Worktree of Repo Y**.

The panel states the 20-Attempt and 30-day boundary beside the discovery action.

**Decision:** A discovered candidate is a **Suggestion**, not an Area resource. It has **Add to Area** and **Dismiss** actions.

Dismissal is durable for that target and Area. The Suggestion can return only after its target or evidence changes.

If no recorded repository or Attempt folder exists, **Discover worktrees** stays available. It explains **Add a repository or run a Goal from a folder first.**

During discovery, each repository shows **Checking worktrees…**. Results from one repository remain available if another repository fails.

A failed source shows **Could not inspect _repository_.** It keeps **Retry** and path-copy actions for that repository.

**Decision:** Discovery never changes worker launch behavior. It also never places a Block.

### Add and edit

The panel offers **Add Worktree**, **Add Repository**, and **Add Link**.

For a local target, Julian supplies an absolute path and an optional label. The confirmation shows the exact path that **Copy path** will copy.

If the path does not exist, the panel asks whether to add it as **Missing**. The product does not silently reject a future target.

If a declared Worktree exists but Git does not recognize it, the row shows **Not a worktree**.

For a link, Julian supplies an HTTP or HTTPS URL and an optional label. The product rejects unsafe URL schemes.

Provider recognition enriches the kind and state. It does not change the URL or primary action.

Julian can rename a direct resource or replace its target. Target replacement shows the old and new targets before it saves.

If the new target matches another same-kind resource in that Area, Save stops with **Already a Map resource in this Area.**

The error offers **Open resource** and **Show on Map**. It keeps the draft and never merges identities.

Each Add or Edit view has **Save** and **Discard changes**. Leaving the view keeps a dirty draft under the shared Back rule.

The resource and every Block keep their current facts until Save succeeds. **Saving…** disables another catalog mutation, but not copy or open.

After target replacement succeeds, the association and Blocks keep identity and geometry. Old target state and freshness are removed immediately.

A new local target starts at **Not checked**, then **Checking** when visible. A new link starts at **Checking** without a lifecycle state or green rail.

**Change to Repository** keeps association and Block identity. It resets local target state before the Repository check.

If resource truth changes during editing, the panel keeps the draft and shows **Resources changed. Reload before you save.**

### Place, locate, hide, and remove

**Place on Map** starts explicit placement in the owning Area. Julian chooses the position.

An inherited row labels this action **Place in _source Area_**. It never places the Block inside the descendant by implication.

If Focus or Only hides the owning Area, the action explicitly says **Exit Focus and place** or **Exit Only and place**.

Placement cancel restores the prior Focus, Only, and fold masks. Placement commit records those prior masks as one view step.

**Add to this Area** creates a direct descendant association. The direct row replaces the inherited row and notes **Also from _source Area_**.

The source Area can keep its own Block. The descendant can place another because Map representation belongs to each association.

At wide widths, the panel can remain open during placement. At narrow widths, it closes and shows a compact placement instruction with **Cancel**.

An **On Map** row uses **Show on Map**. This action selects the Block, temporarily reveals folded ancestors, and moves the camera to it.

For an inherited resource, the label is **Show in _source Area_**.

If Focus or Only hides that Area, the action explicitly says **Exit Focus and show** or **Exit Only and show**.

If both masks apply, the label names both changes. Opening the panel or copying the target never changes either mask.

**Show on Map** creates one atomic locate layer. It owns the resulting selection, camera, Focus, Only, and fold changes.

Show closes the Resources panel and focuses the selected Block. The locate layer also stores the panel row that invoked it.

One Back or Escape restores the complete pre-Show state and panel opener. Manual selection keeps the normal selection-then-camera Back order.

**Hide** removes only the live Block. The resource stays in the panel and picker as **Not on Map · Hidden**.

**Restore on Map** restores a hidden Block at its prior position and style. **Place on Map** is for a resource that was never placed.

Map undo restores a hidden or placed Block. The resource association does not enter Map history.

**Remove from Area** removes a direct association. Existing Blocks become dashed `gone` Blocks and keep their geometry.

The panel offers one immediate **Undo** after add, edit, or remove. An inherited resource has **Open source Area** instead of edit or remove.

The Undo notice remains at the panel top until another catalog mutation or the retained shell session ends.

Undo Add removes the association. A placed Block becomes `gone` because Map placement is separate.

If Add associated an existing generic Link, Undo restores its prior Map-only Link source instead.

Undo Edit restores the prior label, target, action, and source facts. It never restores old geometry because Edit never changes geometry.

Undo Remove restores the association. Its `gone` Blocks reconnect in place and recover their authored style.

If a resource is the launch folder, removal remains available.

The panel warns **Workers still start here by default from the Area launch binding (_source Area_).**

Removing the catalog association does not change or remove that launch binding.

## Primary actions and shortcuts

### Action matrix

| Entity | Primary action | Visible selected action | Enter | Double-click | `o` alias |
|---|---|---|---|---|---|
| Worktree | Copy its absolute path | **Copy path** | Copy path | Copy path | No action |
| Repository | Copy its absolute path | **Copy path** | Copy path | Copy path | No action |
| Link | Open its URL | **Open** | Open | Open | Open |
| GitHub PR | Open its URL | **Open PR** | Open | Open | Open |
| Phabricator revision | Open its URL | **Open revision** | Open | Open | Open |
| Document | Open the Document | **Open Document** | Open | Open | Read |
| Goal | Open the Goal | **Open Goal** | Open | Open | Read |
| Area Block | Open or focus its contextual Brain | **Open Brain** or **Focus Brain** | Open or focus | Open or focus | No action |
| `gone` local target | Copy its cached path | **Copy last known path** | Copy | Copy | No action |
| `gone` link target | Open its cached URL | **Open last known link** | Open | Open | Open |
| `gone` without target | No primary action | **Hide Block** | No action | No action | No action |

An Area region or label is not an Area Block. Enter locates it, double-click fits it, and Space folds or unfolds it.

An Outline Area row uses the same locate action. `Command-Shift-Enter` remains the global contextual Brain action.

The selected primary action includes the `Enter` key hint. **Details** and **Hide Block** remain visible secondary actions when they apply.

The semantic action appears only when exactly one total Map element is selected and that element is a semantic Block.

One Block plus ink or another shape is multiple selection. It has no semantic primary action.

Multiple selection shows the selection count and keeps Excalidraw group actions available.

Single-click selects a Block. It never copies a path or opens a target.

`X` continues to mean **Hide Block**. It never removes the Area resource.

`B` continues to open the Block picker. The picker adds an **Area resources** group for the current Area.

`Command-C` continues to copy Excalidraw selection. The Map does not take this platform shortcut for a worktree path.

If the matrix says **No action** for `o`, the Map consumes the key and performs no action.

No new global shortcut is necessary. The visible Resources action is the pointer path for management.

### Action feedback

A successful local action announces **Copied _label_ path.** It does not move focus, selection, camera, Map save state, or history.

If Clipboard access fails, the Map shows **Could not copy _label_ path.** It also shows the exact selectable path and **Retry**.

The fallback is a modal dialog named **Copy _label_ path**. It selects the exact path for native copy and makes the Map inert.

Tab stays inside the dialog. Escape and **Close** remove one layer and restore the exact opener, including the canvas or action button.

The dialog does not claim success. **Retry** uses the same path and stays in the dialog after another error.

If Retry succeeds, the dialog announces **Copied _label_ path**, closes, and restores the exact opener.

A link opens in a new tab with `noopener`. A blocked open shows **Could not open _host_.** It offers **Try again** and **Copy link**.

Blocked-open recovery uses the same modal contract. It restores the exact Open action or canvas opener when it closes.

If **Try again** succeeds, the dialog closes before the new tab opens and keeps the opener as the return target.

If **Copy link** fails, the same dialog shows **Could not copy link** and selects the exact URL for native copy.

Its Retry action copies that URL. Success announces **Copied link**, closes the dialog, and restores the exact opener.

Opening or copying never changes Area, Goal, review, or Map state.

## Link state and visual rules

### Independent state facets

A resource can have one value from each relevant facet. The product does not combine these facts into one ambiguous status.

| Facet | Values | Visible rule |
|---|---|---|
| Area membership | Direct, From _Area_, Suggestion, `gone` | Provenance appears in the panel. `gone` appears on the Block. |
| Map representation | On Map, Never placed, Hidden | Panel only. `gone` is a source state, not a placement state. |
| Local target | Available, Missing, Not a worktree, Access denied, Not checked | Exceptional values appear on the Block and row. |
| Link lifecycle | Provider state, or no lifecycle state | The product keeps provider words. |
| Freshness | Checking, current, Last known, Status unavailable | Last-known state remains visible with its freshness label. |
| Map transport | Loading, Ready, Last known, unreadable, load failed | Existing Area-level surface. |
| Map save | Saved, Saving, Pending, Not saved, conflict | Existing Map-level surface. |

**Decision:** A local path remains copyable in every target state. A missing path can still help Julian repair or recreate that worktree.

**Decision:** A link remains openable during `Last known` or `Status unavailable`. Provider status is context, not permission to navigate.

### Local target state

The product checks local targets when their Map or Resources surface loads. **Refresh path** starts another check.

**Not checked** offers **Check path**. **Checking** keeps the prior fact visible and disables only another check.

**Missing** offers **Refresh path**, **Replace target**, and **Remove from Area**. Its primary Copy action remains available.

**Not a worktree** offers **Change to Repository**, **Replace target**, and **Refresh path**. It does not guess the intended kind.

**Access denied** offers **Refresh path** and Details with the failed target. Tangent does not claim that the path is missing.

If a check fails after a known result, the Block shows **Path last known · _state_**. Details show the time and error.

If no check succeeds, the Block shows **Path status unavailable**. This label remains distinct from the Area-level **Last known** transport label.

Membership state has first priority on a Block. A `gone` Block then shows target state and its last-known primary action.

Provider lifecycle and freshness can appear together. The green rail follows lifecycle, not transport or freshness.

### Provider lifecycle

**Decision:** The Map uses provider vocabulary instead of one invented review state model.

**Assumption:** Provider contracts can return stable labels and update times for the states that Tangent shows.

Examples include:

- GitHub: **Draft**, **Open**, **Merged**, and **Closed**.
- Phabricator: **Needs Review**, **Accepted**, **Closed**, and **Abandoned**.

**Decision:** **Accepted** and **Merged** are successful while the provider reports those states.

They get a green state rail on the Block's left edge, a check mark, and the state word.

The system owns this rail. It makes the entity visibly green without overwriting the authored Excalidraw fill, stroke, or style.

Open and draft states remain neutral. Closed and abandoned states are muted and always retain their state text.

The product does not use red for a closed review unless the provider reports a failure. A closed review is not always a failed review.

### Refresh and transition behavior

The product refreshes provider state when the Map or Resources panel loads. It also provides a visible **Refresh status** action.

If refresh succeeds, the fact changes in place. The Block does not move, resize, reorder, enter history, or make the Map unsaved.

If refresh fails after a known state, the product keeps that state and adds **Last known**. Resource details show the update time.

If no state ever loaded, the product shows **Status unavailable**. It keeps **Open** and **Copy link** available.

An automatic state change never steals focus. If the affected entity has focus, a polite announcement gives its label and new state.

Background updates do not announce every change. The updated state remains available in the Block, Outline, and Resources panel.

## Find, picker, and Outline

### Find

Map Find searches placed entities only. It matches a resource label, branch, path tail, host, review number, and visible state.

Find keeps its existing cancellation contract. Cancel restores the prior camera and selection exactly.

Unplaced resources do not appear in Map Find. The Resources panel has a filter for the complete Area inventory.

### Block picker

The `B` picker adds **Resources in _Area_** before general Documents, Goals, Areas, and URLs.

Each resource choice shows its kind, label, target clue, state, and Map representation state.

Choosing an **On Map** resource locates it. Choosing **Hidden** offers **Restore on Map**. Choosing **Never placed** starts placement.

Pasting a URL keeps the existing generic Link behavior. If the URL matches an Area resource, the picker uses that source-backed resource.

Pasting an absolute path offers **Add Worktree to _Area_**. It requires explicit confirmation before placement.

A new generic Link stays Map-only until Julian uses **Add to Area**. Placement alone does not create catalog membership.

The generic Link belongs spatially to its placement Area. Focus and fold must not treat it as Area-neutral.

**Add to Area** associates the existing Block in place. It preserves geometry and style and enters one explicit resource-management undo step.

### Accessible Outline

The Outline includes resource and Document Blocks under their owning Areas. A Block row exposes its kind, label, state, and primary action.

Arrow keys move tree focus. Space selects and fits a Block. Enter runs the primary action for an entity row.

For an Area row, Enter locates the Area and Space folds or unfolds it. An Area Block uses **Open Brain** instead.

The help panel explains each action by focused kind.

The focused row and selected canvas Block stay synchronized. A row action never moves keyboard focus to the canvas without user intent.

If the Map has no Blocks, the Outline says **Nothing on the Map yet.** It keeps the **Block** and **Resources** actions available.

## Narrow layout and accessibility

### Narrow layout

At wide widths, an open Brain stays mounted beside the Map while Resources uses the Map pane. Opening Resources does not close the Brain.

At 800 px, the split retains Map and Brain roots. A hidden root remains mounted and inert.

If Brain is visible at 800 px, Julian uses the existing Map control before he opens Resources. Resources never appears over the Brain root.

Work remains a temporary lens above the retained Map. Entering or leaving Work does not erase Resources, selection, or camera state.

The Resources panel becomes a modal sheet inside the Map pane. All content outside the sheet remains mounted and becomes inert.

This boundary includes Map, Brain, Work, and global route controls. Julian closes the sheet before he changes the active surface.

The sheet is named **Map resources · _Area_**. Initial focus goes to its heading, and Tab stays inside the sheet.

Closing the sheet restores its exact opener. It also preserves Map camera, selection, drafts, save state, and terminal state.

**Place on Map** moves focus to a placement preview in the owning Area. The Map owns placement keys until commit or cancel.

The preview starts at the nearest unoccupied grid point to the center of the owning Area's visible bounds.

A pointer click commits the position. Arrow keys move the preview, Enter commits it, and Escape cancels it.

At wide widths, the panel remains visible but does not own placement keys. At narrow widths, the sheet closes before placement.

A compact instruction names the resource and shows the pointer, arrow, Enter, and Escape actions.

After commit, the canvas keeps focus and selects the Block. After cancel, Tangent restores the exact **Place** opener.

At narrow widths, cancel reopens the retained sheet before it restores the Place opener.

Long paths and URLs never increase the viewport width. Rows shorten their middle text and expose the exact target in details.

The selected action strip remains inside the viewport. It shows the action verb and key hint, not the full path.

### Accessibility contract

Every primary action has a visible pointer control and an owned keyboard action. No canvas-only action is acceptable.

All status treatments include text. Success also includes a check mark, so green is never the only signal.

Focus-visible styles use shared semantic tokens. Provider colors do not replace Tangent focus, selection, error, or warning tokens.

One shared Back operation owns Escape and every visible **Back**, **Close**, and **Cancel** action.

Each activation removes exactly one visible layer and restores that layer's exact opener.

The layer order is an inner menu, recovery dialog, placement, Details or Edit, Resources, Show locate layer, ordinary selection, camera step, then route.

Escape from a dirty Edit view keeps its draft. Only **Save** or **Discard changes** resolves that draft.

Escape never drops hidden pane state or applies an edit.

Clipboard errors and blocked opens use polite live announcements. They do not rely on a toast that disappears before assistive technology reads it.

State treatment has no required animation. Any optional transition obeys reduced-motion preferences.

## Empty, loading, stale, error, and interruption states

### Empty

An Area without catalog entries shows **No Map resources for _Area_.** It offers the three Add actions and **Discover worktrees**.

The panel shows this message only after catalog load and legacy scan succeed, with no pending review. It never converts an error into empty state.

If Suggestions exist, the panel says **No confirmed Map resources** and shows those Suggestions under the Add actions.

An Area with resources but no placed Blocks distinguishes **Never placed** from **Hidden**. It does not place either automatically.

An empty Map remains a valid canvas. The Resources empty state does not cover or replace the Map.

### Loading and partial state

On first load, the panel shows **Loading resources…** in its own surface. The Map keeps its existing complete-world loading state.

If initial catalog load fails without cached rows, the panel shows **Map resources did not load.** It provides **Retry** and no empty claim.

If cached rows exist, the panel keeps them and shows **Could not refresh Map resources · Last known.** It provides **Retry**.

Copy and open remain available on cached rows. Add, edit, remove, placement, and resource Undo wait for a current catalog.

If some Area shards fail, available resources and Blocks remain usable. The failed Area keeps its existing retry action.

If a refresh starts after data loaded, the panel keeps the rows. It marks the affected state as **Checking**.

### Stale and unavailable state

If transport becomes stale, the Map keeps the last known resource inventory and status. It labels the affected facts **Last known**.

A stale state never disables **Copy path** or **Open**. The target itself remains useful even when its status is old.

If the product cannot inspect a local path, it distinguishes **Access denied** from **Missing**. It does not guess that the path was deleted.

If provider permission fails before any state loads, the row shows **Status unavailable**.

If permission fails after a known state, the row keeps that state with **Last known**. Details show **Provider access unavailable**.

Neither state exposes credentials or turns an authorization error into `Closed`.

### Catalog mutation errors

The product commits one catalog mutation before it updates confirmed rows or Block facts.

If Add, Edit, Replace target, or Remove fails, the current catalog and Map stay unchanged. The form keeps its draft.

Resource Undo uses the same mutation and error contract.

The form shows **Could not save Map resource.** It provides **Retry**, **Discard changes**, and the available copy or open action.

If authority changed, the form shows **Resources changed. Reload before you save.** **Reload resources** keeps the draft for comparison.

After reload, Julian can apply the draft again or discard it. The product never chooses **Keep mine** for catalog conflicts automatically.

Closing an error restores the exact Save or resource-row opener.

### Removal and external change

If a resource disappears from authority, its Block becomes `gone`. It keeps its last known label, target, geometry, and manual removal action.

A `gone` Block offers **Copy last known path** or **Open last known link** when it has a cached target.

It also offers **Add back to Area** and **Hide Block**. Add back uses the cached facts and requires explicit confirmation.

If no cached target exists, the `gone` Block offers only **Hide Block**.

The Resources panel lists visible ghosts under **Removed from Area** until Julian adds them back or hides their Blocks.

If a missing local target returns, the Block restores its normal source state without changing authored style or position.

If a link target changes outside Tangent, the resource keeps its recorded URL until its authority changes. Redirects do not silently replace it.

### Area lifecycle and structure

An Area rename or move keeps its resource associations and Blocks. Labels and provenance update without Map geometry changes.

Marking an Area `done` or `archived` keeps its catalog and scene. Its resources fold with the Area and remain available to descendants with provenance.

Direct catalog mutation for a `done` or `archived` Area is read-only. Copy, open, Details, and **Show on Map** remain available.

The panel provides **Open Area** and states that Julian must reopen the Area before he changes its resources.

If the owning Area no longer exists, an available composed scene can keep its resource Blocks as `gone`.

**Add target to another Area** creates a new association and requires a new placement. It never rehomes or reconnects the old ghost.

If the old scene is unavailable, the new Area keeps no ghost or geometry from it.

Focus and fold never change catalog membership. **Show on Map** can temporarily change those view masks under the explicit camera-trail rule.

### Save and action interruption

Copy and open actions remain available during a Map save error. These actions do not depend on a successful scene write.

If placement cannot save, the existing **Not saved**, **Retry**, **Reload saved**, and **Keep mine** recovery remains authoritative.

If Julian leaves during resource editing, the retained sheet keeps the draft under the same narrow-layout retention rule.

## Complete journeys

### Common journey: discover and record another worktree

1. Julian opens **Map resources** for the selected Area.
2. He uses **Discover worktrees**. The panel checks recorded repositories and the bounded Attempt history.
3. One Suggestion shows its branch, path, and **Worktree of _repository_** evidence.
4. Julian uses **Add to Area** and reviews the exact path.
5. Save creates one direct catalog association. It does not change the launch folder or place a Block.
6. Julian uses **Place on Map**. He clicks a position or uses arrows and Enter.
7. The new Block stays selected and offers **Copy path**, **Details**, and **Hide Block**.

### Common journey: copy one of several worktree paths

1. Julian selects an Area and opens **Resources**.
2. The heading names the Area. The Worktrees group shows labels, branches, paths, and exceptional state.
3. Julian selects a row and uses **Place on Map** if it is not present.
4. Julian chooses the Block position. Tangent selects the new Block without changing its catalog association.
5. Julian later selects the Block and presses Enter.
6. Tangent copies the exact absolute path and announces **Copied _label_ path.**
7. Julian pastes the path into his chosen tool. The Map selection and camera stay intact.

The repeated journey starts at step 5. It needs no Brain message and no resource panel.

### Common journey: open an accepted revision

1. Julian sees a Phabricator revision Block with **Accepted**, a check mark, and a green state rail.
2. Julian selects it and presses Enter, double-clicks it, or uses **Open revision**.
3. Tangent opens the recorded URL in a new tab with `noopener`.
4. The Map stays selected at the revision. No Goal, Area, review, or Map state changes.

### Recovery journey: Clipboard permission fails

1. Julian presses Enter on a Worktree Block.
2. The clipboard rejects the request.
3. Tangent shows **Could not copy _label_ path.** It exposes the exact path in a selectable field.
4. Julian copies from the field or uses **Retry**.
5. Closing the dialog restores the exact canvas or **Copy path** opener and preserves Map context.

### Recovery journey: provider state becomes stale

1. A revision previously showed **Accepted**.
2. A later refresh cannot reach its status authority.
3. The Block keeps **Accepted** and adds **Last known**.
4. The green success treatment remains because the last known lifecycle state is successful.
5. The Resources panel shows the update time and **Refresh status**.
6. A successful refresh removes **Last known** without changing the Map scene.

### Recovery journey: a worktree was removed outside Tangent

1. A path check no longer finds the Worktree.
2. The Block shows **Missing** and keeps **Copy path**.
3. The Resources row offers **Refresh path**, **Replace target**, and **Remove from Area**.
4. If the path returns, the Block clears **Missing** without moving.
5. If Julian removes the association, the Block becomes `gone` and keeps its geometry.

## Counterexamples and abstraction limits

- A repository can have unrelated worktrees. Discovery is not proof of Area membership.
- A recent Goal folder can be temporary. Attempt use is only suggestion evidence.
- Two Areas can intentionally use the same worktree or review. Cross-Area equality is not a duplicate error.
- A branch can have a ref or provider URL. This design keeps it as metadata because path and link actions cover the current intent.
- A command has side effects, progress, and recovery. It remains an Area Operation.
- A generic URL can have no provider integration. It remains an openable Link without invented lifecycle state.
- A missing worktree path can still help repair work. **Missing** does not disable copying.
- A closed review is not always a failed review. The product does not make every closed state red.
- A successful external state must not overwrite Julian's selected Block color. Success uses a system-owned treatment.
- A hidden Block is not a removed resource. These actions remain separate in language, state, and undo behavior.

## Non-goals

- Open a worktree in Finder, Terminal, an editor, or another application.
- Execute `cd`, `pbcopy`, Git, or shell commands through a Brain.
- Create, delete, prune, repair, or switch Git worktrees.
- Change the Area launch folder or a Goal `--path`.
- Infer Area membership from every Git worktree or Agent Attempt.
- Turn branches, commands, skills, arbitrary files, or environments into Map Blocks.
- Build a GitHub or Phabricator client inside the Map.
- Edit, merge, accept, close, or comment on a review.
- Treat URL reachability as review lifecycle state.
- Automatically place, move, resize, connect, group, or restyle Blocks because discovery or state refresh occurred.
- Replace the current Map save, conflict, Focus, fold, Find, or camera models.
- Add batch open or batch copy for multiple selected Blocks.
- Select the resource storage format, status API, credential model, polling interval, or cache design.

## Assumptions, risks, and unknowns

### Assumptions

**Assumption:** Julian wants the path copied for use in another tool. He does not want the Map to choose that tool.

**Assumption:** A future status authority can report GitHub and Phabricator lifecycle with a meaningful update time.

### Risks

The word **Resources** covers launch folders, free-form Knowledge, skills, commands, and more in older records.

The **Map resources** heading qualifies this panel as actionable Map targets. Toolbar context permits the shorter **Resources** action.

Status color can conflict with authored shape color. The system-owned green rail must remain visibly separate from Excalidraw style.

Discovery can reveal many worktrees. Bounded sources, provenance, dismissal, and explicit addition limit this noise.

### Unknowns that require code design

**Unknown:** Which storage and API implement catalog authority, atomic mutation, migration, and one-step resource Undo?

**Unknown:** Which trusted service supplies GitHub and Phabricator state, authentication, freshness, and provider errors?

**Unknown:** Which freshness interval balances useful automatic state with provider cost? The product contract requires update time and manual refresh.

These unknowns do not change the selected interaction model. They must be resolved before implementation connects live resource or provider data.

### Reconsider this design if

- Area Knowledge becomes a validated multi-resource authority with explicit user editing rules.
- The Map replaces Tangent Blocks with another semantic entity model.
- Single-click becomes the primary semantic action across all Map entities.
- A provider cannot supply reliable lifecycle state or update time.
- Resource discovery expands beyond bounded Area repositories and recorded attempt folders.

## Proof contract for implementation

Future implementation proof must use an isolated fixture. It must not use the real vault, live port `4321`, or the real tmux namespace.

### Behavior proof

- An Area fixture has three worktrees with distinct branches, one inherited repository, and two review links.
- First load offers legacy review without changing catalog membership, Area prose, launch binding, or Map placement.
- **Import selected** is atomic and repeatable across retry, pre-existing rows, same-kind duplicates, and cross-kind targets.
- An import error keeps every selected row unimported and prevents a false empty state.
- A free-form path or URL becomes a Suggestion and never becomes confirmed membership without **Add to Area**.
- Enter, double-click, and **Copy path** copy the same exact absolute path with no newline.
- Clipboard denial shows the modal fallback and restores the exact canvas or **Copy path** opener.
- Copy or open retry success closes its dialog, announces success when applicable, and keeps the exact return target.
- Copy-link denial selects the exact URL in the same modal and never creates a nested error surface.
- Enter, double-click, and **Open** dispatch one new-tab action with `noopener`.
- A blocked open shows **Could not open _host_.** and **Copy link**.
- Lifecycle changes from **Open** to **Accepted** or **Merged** add exact state text, a check mark, and the green state rail.
- State refresh does not write the Map or change geometry, selection, camera, history, groups, bindings, z-order, or authored style.
- Missing, returned, `gone`, Last known, Status unavailable, and permission states keep the rules in this record.
- A focused lifecycle change announces politely without focus theft. A background change does not announce globally.
- Target replacement keeps Block identity and geometry but changes the exact Copy or Open target after Save succeeds.
- Target replacement removes old lifecycle, freshness, and green treatment before it checks the new target.
- An inherited row cannot edit or remove its source. **Add to this Area** creates a distinct descendant association.
- Pointer and keyboard placement commit the same owner and position. Escape cancels placement and restores its exact opener.
- Keyboard placement starts at the nearest unoccupied grid point to the owning Area center.
- Show and placement name and preserve prior Focus, Only, fold, camera, and selection state under their Back rules.
- Never placed, On Map, Hidden, and `gone` remain distinct. Restore uses the hidden Block's prior position and style.
- One association has at most one live Block. Exact duplicates in one Area locate it, while the same target in another Area is allowed.
- A generic URL Block stays Map-only until explicit association. Association and Undo preserve its geometry and prior Map-only state.
- Unsafe URL schemes fail before membership or placement changes.
- Area rename, move, done, archived, and missing-source fixtures preserve the lifecycle rules in this record.
- Place, Show on Map, Hide, Remove from Area, and each resource-management Undo remain distinct.
- Find restores exact camera and selection after cancellation.
- A selected resource survives entry to and exit from the Work lens under the retained-state rule.

### Accessibility and narrow proof

- The Outline exposes every placed resource under its owning Area.
- The selected primary-action button, Enter, canvas double-click, and Outline Enter reach the same semantic dispatch.
- An Area Block opens or focuses Brain, while an Area region and Outline row locate the Area.
- No resource shortcut operates while text input, a dialog, Work, or the terminal owns the key.
- Axe and keyboard passes cover the Resources panel, fallback dialog, picker, Outline, and selected action strip.
- Every resource accessible name contains kind, label, state, owning Area, and exact target.
- The narrow sheet has a name, heading focus, contained Tab order, inert Map background, and exact opener restoration.
- The narrow modal also makes Brain, Work, and global route controls inert until Close.
- Back removes one inner layer, placement, Details or Edit, panel, Show locate layer, selection, camera step, or route.
- A dirty edit survives Back until explicit **Save** or **Discard changes**.
- State remains understandable with color removed and under reduced motion.
- At 800 px, every action stays inside the viewport and the hidden pane is inert.
- At 520 px, long paths do not create horizontal page scroll or cover save and recovery controls.
- Closing the narrow Resources sheet restores focus and preserves camera, selection, drafts, save state, and terminal state.
- An empty Outline retains the visible **Block** and **Resources** actions.

### Empty and error proof

- A new Area with no catalog entries shows **No Map resources** only after load and migration succeed.
- Partial Area loading keeps available resource actions usable.
- Catalog load with no cache shows a named error and Retry, never a false empty state.
- Catalog refresh with a cache keeps Last-known rows and disables mutation while copy and open remain available.
- Add, Edit, Replace, Remove, and conflict errors keep confirmed facts, Map geometry, and the edit draft.
- Provider permission before first state shows Status unavailable. Later permission loss keeps the prior state as Last known.
- Discovery proves the 20-Attempt and 30-day boundary, per-repository progress, partial success, dismissal, and retry.
- Initial resource load, refresh, stale transport, path permission, provider permission, and save errors use separate recovery surfaces.
- Copy and open remain available during a Map save error.

## Evidence index

### Governing decisions

- `docs/decisions/ADR-0049-area-excalidraw-scenes.md:13-24` defines Tangent Blocks, source facts, and Julian's layout authority.
- `docs/decisions/ADR-0049-area-excalidraw-scenes.md:25` is superseded only for catalog-backed resource fact authority.
- `docs/decisions/ADR-0051-one-composed-area-map-world.md:19-49` defines the composed world and retained controller state.
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md:19-79` defines keyboard ownership and parity.
- `docs/design/map-first-main-surface/design-record.md:128-215` defines Map-first routing, narrow retention, and complete journeys.
- `docs/design/agent-shell-enter-key/design-record.md:54-64` defines plain Enter as the object action.
- `docs/design/area-note-as-system-prompt/design-record.md:213-242` defines free-form Knowledge, multiple repositories, and no Tangent note writes.

### Current implementation and tests

- `packages/agent-shell/app/area-resources.mjs:14-144` contains the singular resource parser, inheritance, folder resolution, and unbound error.
- `packages/agent-shell/app/area-resources.test.mjs:9-78` proves current precedence, provenance, and missing-path behavior.
- `packages/agent-shell/app/public/area-board-core.js:16-260` contains Block kinds, source facts, link inference, and picker choices.
- `packages/agent-shell/app/browser/area-map-world.jsx:469-676` contains Find, Block placement, and semantic dispatch.
- `packages/agent-shell/app/browser/area-map-world.jsx:1187-1648` contains key ownership, Outline, actions, status, picker, and help.
- `packages/agent-shell/app/area-map-world-browser.test.mjs:385-495` proves fact refresh and selection-before-action behavior.
- `packages/agent-shell/app/area-board-browser.test.mjs:683-900` proves retained and inert narrow panes and Work-lens retention.
- `packages/agent-shell/app/public/shell.js:1977-2053` contains Map entity indexing and semantic route actions.
- `packages/agent-shell/app/public/shell-event-bindings.js:900-930` contains the reusable copy and blocked-open feedback.
- `packages/agent-shell/app/goal-cards.mjs:3-81` contains link, copy, and review-card validation.

### Product evidence and precedents

- `docs/design/agent-shell-operating-vision/evidence/worker-cwd.md:79-85` records Areas whose attempts used multiple worktrees.
- `docs/design/agent-shell-brain-cards/user-intent.md:7-14` records the request for copy text, links, and Phabricator reviews.
- `docs/design/agent-shell-brain-cards/design-record.md:246-261` defines the closest copy and open action precedent.
- `ecd6d091:packages/agent-shell/app/browser/area-board-excalidraw.jsx:228-247` contains the historical Inbox and explicit Place action.
- `docs/decisions/ADR-0048-area-json-canvas-authority.md:3,37` marks that Inbox path as superseded and preserves explicit placement history.
- `docs/ui/accessibility.md:3` sets the WCAG 2.2 AA baseline.
- `docs/ui/design-principles.md:3` requires one job, visible actions, caveats, and progressive disclosure.
- `docs/ui/tokens.md:3-5` requires shared semantic tokens.
