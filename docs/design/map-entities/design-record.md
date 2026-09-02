# First-class Area resources on the Map

- **Status:** Product and code design complete
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

**Decision:** One versioned JSON catalog file in each Area stores direct resource associations. The Area path supplies ownership.

**Decision:** A resource Block stores one stable association ID. The catalog supplies its target, and an observation cache supplies observed state.

**Decision:** One closed action union serves pointer, Enter, double-click, and Outline callers. It replaces raw `kind` and `verb` dispatch.

**Decision:** Provider status uses two explicit server-side reader interfaces. The Map receives typed GitHub and Phabricator facts only.

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

The code design below selects catalog storage, APIs, provider reader interfaces, and compatibility. It does not reopen this product authority rule.

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

## Code design

### Selected lenses

This code design uses four lenses: architecture and data, API, migration compatibility, and runtime operations.

The contract stays private to Agent Shell. Only Git worktree inspection belongs in `@tangent/repo`.

No resource type belongs in `@tangent/core`. No other vertical package needs this domain.

### Authority split

The feature has four authorities. Each authority owns a different class of fact.

| Authority | Owns | Does not own |
|---|---|---|
| Area resource catalog | Direct association identity, label, exact target, removal tombstone, reviewed import, suggestion decision | Launch folder, placement, provider state |
| Area Excalidraw shard | Block presence, hidden record, geometry, style, groups, bindings, and z-order | Resource target, label authority, observed state |
| Resource observation cache | Local target state, Git facts, provider lifecycle, freshness, and bounded errors | Membership, target, Map revision |
| Legacy Area note parser | Existing launch-folder and service compatibility | Map resource membership |

One exact Area owns each direct association. Descendants receive a derived, read-only projection.

The owning Area comes from the catalog file path. A catalog record does not repeat the Area path.

This rule lets an Area move carry its catalog without an internal path rewrite. The current move already carries every file in the subtree.

The legacy `Repository`, `Worktree`, and `Branch` parser remains unchanged. Its public types and launch behavior remain unchanged.

The service-specific note parser also remains unchanged. Its existing difference from the public parser is separate technical debt.

### Rejected code alternatives

A generated Markdown section conflicts with the no-note-write rule. It also preserves the current singular parser problem.

One global catalog weakens exact Area ownership. It also requires path rewrites and wider conflict scopes during Area moves.

Persisting each target snapshot on its Block duplicates catalog authority. Every target edit then requires an unrelated scene write.

Catalog tombstones keep `gone` actions without that coupling. They also keep fact edits outside Map history.

Putting resource observations in `area-map-world.v1` creates false world revisions and save conflicts. A separate fact projection avoids them.

Encoding local resources as existing Link or Document kinds gives unsafe dispatch semantics. It also hides the mixed-version reader requirement.

A generic provider registry has no current consumer or package precedent. Two named provider reader interfaces cover the demonstrated variation.

### Catalog file and persisted types

Each physical Area can contain one reserved file:

```text
<area>/map-resources.json
```

JSON avoids creating a vault Document. Area discovery already ignores non-Markdown files.

The resource store reads this file directly. It does not depend on the Markdown-only vault fingerprint.

A missing file is a valid empty catalog. Malformed or unsupported content is an error, never an empty catalog.

The persisted target-kind union is closed and small:

```ts
type ResourceId = string & { readonly __resourceId: unique symbol };
type AbsolutePath = string & { readonly __absolutePath: unique symbol };
type HttpUrl = string & { readonly __httpUrl: unique symbol };
type MailtoUrl = string & { readonly __mailtoUrl: unique symbol };
type VaultFile = string & { readonly __vaultFile: unique symbol };
type VaultSubpath = string & { readonly __vaultSubpath: unique symbol };
type SafeExternalUrl = HttpUrl | MailtoUrl;

type AreaResourceTargetV1 =
  | { kind: "worktree"; path: AbsolutePath }
  | { kind: "repository"; path: AbsolutePath }
  | { kind: "link"; url: HttpUrl };

type LegacyResourceOriginV1<F extends "Repository" | "Worktree"> = {
  kind: "legacy-area-binding";
  field: F;
  evidenceHash: string;
  declaredBranch: string | null;
};

type AreaResourceRecordBaseV1 = {
  id: ResourceId;
  label: string | null;
  membership:
    | { state: "active" }
    | { state: "removed"; removedAt: string };
  createdAt: string;
  updatedAt: string;
};

type AreaResourceRecordV1 = AreaResourceRecordBaseV1 & (
  | {
      target: Extract<AreaResourceTargetV1, { kind: "worktree" }>;
      origin: LegacyResourceOriginV1<"Worktree"> | null;
    }
  | {
      target: Extract<AreaResourceTargetV1, { kind: "repository" }>;
      origin: LegacyResourceOriginV1<"Repository"> | null;
    }
  | {
      target: Extract<AreaResourceTargetV1, { kind: "link" }>;
      origin: null;
    }
);

type SuggestionEvidenceV1 =
  | { kind: "legacy-area-binding"; field: "Repository" }
  | { kind: "legacy-area-binding"; field: "Worktree" }
  | { kind: "knowledge-line" }
  | { kind: "attempt"; jobSlug: string; run: number; assignmentId: string; attemptId: string }
  | { kind: "git-worktree"; repositoryTargetFingerprint: string; pathFingerprint: string };

type NonLegacySuggestionEvidenceV1 = Exclude<
  SuggestionEvidenceV1,
  { kind: "legacy-area-binding" }
>;

type SuggestionDecisionBaseV1 = {
  evidenceHash: string;
  targetFingerprint: string;
  decidedAt: string;
};

type SuggestionDecisionV1 =
  | (SuggestionDecisionBaseV1 & {
      decision: "dismissed";
      evidence: NonLegacySuggestionEvidenceV1;
      resourceId: null;
    })
  | (SuggestionDecisionBaseV1 & {
      decision: "imported";
      evidence: SuggestionEvidenceV1;
      resourceId: ResourceId;
    });

type AreaResourceCatalogV1 = {
  schema: "area-map-resources.v1";
  resources: AreaResourceRecordV1[];
  suggestionDecisions: SuggestionDecisionV1[];
};
```

The file does not persist a revision counter. The API revision is the hash of the exact file bytes.

The missing-file revision is `null`. A first write uses `null` as its compare-and-swap value.

The validator accepts additive non-discriminant object fields and preserves them during a mutation.

An unknown discriminant in a target, membership, origin, evidence, or decision makes the whole catalog read-only and unsupported.

This rule prevents an older writer from removing a newer union variant.

A legacy origin is valid only on a local target, and its field must match the Worktree or Repository kind. Link origin is always null.

The catalog persists removed records as tombstones. A tombstone is not active membership and does not flow to descendants.

The tombstone keeps the last exact target and label. Therefore, a `gone` Block keeps its action after a process restart.

Tombstones do not appear in ordinary inventory. The panel shows one under **Removed from Area** only while its owning source has a visible `gone` Block.

Hiding that ghost removes its row. The hidden source record remains available to compatibility readers and Map resolution.

The first release keeps tombstones without compaction. This rule prevents ID reuse and avoids a second retired-ID store.

The structured evidence identity is local to the catalog. It does not contain an Area path or canonical note path.

Therefore, an Area move does not change a dismissal or reviewed-import baseline.

Observed provider state does not enter the catalog. GitHub and Phabricator classification is a derived Link facet.

No generic metadata bag exists. Branch, repository, provider, lifecycle, action, freshness, launch match, and Map state are derived.

### Identity, normalization, and relation invariants

The server generates one opaque UUID for each new association. A target never supplies the ID.

Resource IDs are unique within one catalog file. A suggestion decision is unique by evidence, evidence hash, and target fingerprint.

An imported decision can reference only a record in the same catalog. Removal keeps that ID as a tombstone.

An inherited match does not supply a catalog-local ID.

The persisted association ID is stable. The runtime locator is an address in the current Area tree:

```ts
type AreaPath = string & { readonly __areaPath: unique symbol };
type ResourceLocator = { owner: AreaPath; id: ResourceId };
```

The ID stays stable across an Area move, rename, and target replacement. Removal retires the ID.

An Area move changes the locator because the owner path changes. The source Block keeps `ref: id`, and its new source owner supplies the new locator.

The move invalidates old locator and revision authority. The next tree and catalog projection returns the new locator.

The browser keeps dirty draft contents. It remaps a draft by stable ID when possible and marks it stale for compare, reload, or discard.

Any successful user Edit clears `legacy-area-binding` origin. Undo Edit restores the prior origin with the prior fields.

Undo Remove can reactivate that ID during the immediate undo window. A later Add creates a new ID.

Add back from a `gone` Block creates a new association. One exact scene transaction rewrites that Block to the new ID.

This explicit rewrite preserves geometry. A same-target resource added elsewhere never reconnects the old Block by itself.

If that Area already has the same active kind and target, Add back returns the normal duplicate conflict and leaves the ghost unchanged.

Path normalization expands `~`, requires an absolute path, and removes redundant and trailing separators.

Path normalization does not call `realpath`. It does not resolve symlinks or change letter case.

Best-effort filesystem identity can detect aliases after a read. It supplies warnings only and never changes identity, duplicate checks, or persisted targets.

If either path is inaccessible, the server makes no alias claim.

The panel compares accessible local rows in its selected projection. A shared filesystem identity adds `path-alias` warnings to those rows.

URL normalization accepts only HTTP and HTTPS. It lowercases only the host name and preserves the recorded scheme, path, query, and fragment.

Redirects never participate in identity or duplicate detection.

One active direct catalog cannot contain two records with the same target kind and normalized target.

The same target can appear under a different kind. The mutation succeeds with a warning.

Warnings use one closed union:

```ts
type ResourceWarning =
  | { kind: "path-alias"; other: ResourceLocator }
  | { kind: "cross-kind-target"; other: ResourceLocator };
```

Different Area catalogs can contain the same kind and target. Each record has a different identity.

An inherited row always points to its source locator. A descendant mutation cannot name that locator as its own direct record.

The descendant **Add to this Area** action creates a new record in the descendant catalog.

The read projection walks the selected Area and then its ancestors, nearest first.

Inherited associations remain separate rows, even when their kinds and normalized targets match.

Only a direct selected-Area association suppresses inherited rows with the same kind and target. Its `alsoFrom` lists every suppressed source Area.

This display rule does not merge identities or catalogs. Counts include every confirmed association before display suppression.

Opening a source Area still shows its direct association. Every visible inherited row keeps its own source actions and placement.

The Worktree label fallback order is the explicit label, observed branch, legacy declared branch, folder name, and shortened path.

The Repository order is the explicit label, folder name, and shortened path.

The Link order is the explicit label, recognized provider identifier, host, and shortened URL.

The UI always labels a legacy declared branch as declared. It never presents it as the current branch.

### Derived resource read model

The server joins catalogs, raw source shards, launch binding, and cached observations into one read model.

The joined model distinguishes an unavailable catalog from a removed resource. A read error never creates a false `gone` state.

```ts
type LocalObservationError = {
  code: "local-check-failed" | "observation-capacity";
  message: string;
  retryable: boolean;
};

type ProviderObservationError = {
  code:
    | "provider-access-unavailable"
    | "provider-timeout"
    | "provider-unavailable"
    | "provider-state-unsupported"
    | "observation-capacity";
  message: string;
  retryable: boolean;
};

type ProviderReadError = {
  code: "provider-access-unavailable" | "provider-unavailable";
  message: string;
  retryable: boolean;
};

type Observation<T, E> =
  | { state: "not-checked"; value: null; checkedAt: null }
  | { state: "checking"; value: T | null; checkedAt: string | null }
  | { state: "current"; value: T; checkedAt: string }
  | { state: "last-known"; value: T; checkedAt: string; error: E }
  | { state: "unavailable"; value: null; checkedAt: null; error: E };

type GitCheckout =
  | { kind: "branch"; head: string; branchRef: string }
  | { kind: "detached"; head: string }
  | { kind: "bare"; head: string | null };

type WorktreeFact =
  | { state: "available"; checkout: Exclude<GitCheckout, { kind: "bare" }>; repositoryPath: AbsolutePath }
  | { state: "missing" }
  | { state: "not-a-worktree" }
  | { state: "access-denied" };

type RepositoryFact =
  | { state: "available"; checkout: GitCheckout }
  | { state: "missing" }
  | { state: "access-denied" };

type ProviderLifecycle = {
  stateLabel: string;
  treatment: "success" | "neutral" | "muted";
  providerUpdatedAt: string;
};

type LinkFacet =
  | { kind: "generic" }
  | {
      kind: "github-pr";
      owner: string;
      repository: string;
      number: number;
      lifecycle: Observation<ProviderLifecycle, ProviderObservationError>;
    }
  | {
      kind: "phabricator-revision";
      baseUrl: HttpUrl;
      revisionId: `D${number}`;
      lifecycle: Observation<ProviderLifecycle, ProviderObservationError>;
    };

type ResourceRepresentation = "on-map" | "never-placed" | "hidden";

type ResourceProjectionErrorBase<S extends "area-note" | "source-scene"> = {
  source: S;
  owner: AreaPath;
  message: string;
};

type ResourceProjectionError<
  S extends "area-note" | "source-scene" = "area-note" | "source-scene",
> =
  | (ResourceProjectionErrorBase<S> & {
      code: "resource-source-load-failed";
      retryable: true;
    })
  | (ResourceProjectionErrorBase<S> & {
      code: "resource-source-invalid";
      retryable: false;
    });

type DerivedResourceFact<T, E extends ResourceProjectionError> =
  | { state: "current"; value: T }
  | { state: "unavailable"; error: E };

type AreaResourceEntityBase = {
  locator: ResourceLocator;
  label: string;
  representation: DerivedResourceFact<
    ResourceRepresentation,
    ResourceProjectionError<"source-scene">
  >;
  origin: AreaResourceRecordV1["origin"];
  warnings: readonly ResourceWarning[];
};

type AreaResourceEntity = AreaResourceEntityBase & (
  | {
      target: Extract<AreaResourceTargetV1, { kind: "worktree" }>;
      local: Observation<WorktreeFact, LocalObservationError>;
      link: null;
    }
  | {
      target: Extract<AreaResourceTargetV1, { kind: "repository" }>;
      local: Observation<RepositoryFact, LocalObservationError>;
      link: null;
    }
  | {
      target: Extract<AreaResourceTargetV1, { kind: "link" }>;
      local: null;
      link: LinkFacet;
    }
);

type GoneResourceEntityBase = {
  locator: ResourceLocator;
  representation: "on-map" | "hidden";
  warnings: readonly ResourceWarning[];
};

type GoneResourceEntity = GoneResourceEntityBase & (
  | { reason: "removed"; lastKnown: { label: string; target: AreaResourceTargetV1 } }
  | { reason: "missing-record" | "missing-owner"; lastKnown: { label: string; target: AreaResourceTargetV1 } | null }
);

type AreaResourcePanelRow =
  | {
      viewedFrom: AreaPath;
      relation: { kind: "direct" };
      alsoFrom: readonly AreaPath[];
      launchMatch: DerivedResourceFact<boolean, ResourceProjectionError<"area-note">>;
      entity: AreaResourceEntity;
    }
  | {
      viewedFrom: AreaPath;
      relation: { kind: "inherited"; sourceArea: AreaPath };
      alsoFrom: readonly [];
      launchMatch: DerivedResourceFact<boolean, ResourceProjectionError<"area-note">>;
      entity: AreaResourceEntity;
    }
  | {
      viewedFrom: AreaPath;
      relation: { kind: "direct" };
      alsoFrom: readonly [];
      launchMatch: DerivedResourceFact<boolean, ResourceProjectionError<"area-note">>;
      entity: GoneResourceEntity & {
        reason: "removed" | "missing-record";
        representation: "on-map";
      };
    };

type CatalogReadError = {
  owner: AreaPath;
  code: "catalog-load-failed" | "catalog-invalid" | "catalog-unsupported";
  message: string;
  retryable: boolean;
};

type AreaResourceReadProblem =
  | { kind: "catalog"; error: CatalogReadError }
  | { kind: "projection"; error: ResourceProjectionError };

type CatalogRevision = { owner: AreaPath; revision: string | null };

type SuggestedResourceTarget =
  | AreaResourceTargetV1
  | { kind: "local-path"; path: AbsolutePath };

type SuggestionIdentity<
  T extends SuggestedResourceTarget,
  E extends SuggestionEvidenceV1,
> = {
  owner: AreaPath;
  target: T;
  evidence: E;
  evidenceHash: string;
  targetFingerprint: string;
};

type SuggestionFacts<
  T extends SuggestedResourceTarget,
  E extends SuggestionEvidenceV1,
> = SuggestionIdentity<T, E> & {
  proposedLabel: string | null;
  provenanceLabel: string;
};

type ResourceSuggestion =
  | SuggestionFacts<
      Extract<AreaResourceTargetV1, { kind: "link" }>,
      Extract<SuggestionEvidenceV1, { kind: "knowledge-line" }>
    >
  | SuggestionFacts<
      { kind: "local-path"; path: AbsolutePath },
      Extract<SuggestionEvidenceV1, { kind: "knowledge-line" }>
    >
  | SuggestionFacts<
      Extract<AreaResourceTargetV1, { kind: "worktree" }>,
      Extract<NonLegacySuggestionEvidenceV1, { kind: "attempt" | "git-worktree" }>
    >;

type ResourceSuggestionReference =
  | SuggestionIdentity<
      Extract<AreaResourceTargetV1, { kind: "link" }>,
      Extract<SuggestionEvidenceV1, { kind: "knowledge-line" }>
    >
  | SuggestionIdentity<
      { kind: "local-path"; path: AbsolutePath },
      Extract<SuggestionEvidenceV1, { kind: "knowledge-line" }>
    >
  | SuggestionIdentity<
      Extract<AreaResourceTargetV1, { kind: "worktree" }>,
      Extract<NonLegacySuggestionEvidenceV1, { kind: "attempt" | "git-worktree" }>
    >;

type LegacyResourceCandidate =
  | SuggestionFacts<
      Extract<AreaResourceTargetV1, { kind: "repository" }>,
      Extract<SuggestionEvidenceV1, { kind: "legacy-area-binding"; field: "Repository" }>
    >
  | SuggestionFacts<
      Extract<AreaResourceTargetV1, { kind: "worktree" }>,
      Extract<SuggestionEvidenceV1, { kind: "legacy-area-binding"; field: "Worktree" }>
    >;

type LegacyResourceReference =
  | SuggestionIdentity<
      Extract<AreaResourceTargetV1, { kind: "repository" }>,
      Extract<SuggestionEvidenceV1, { kind: "legacy-area-binding"; field: "Repository" }>
    >
  | SuggestionIdentity<
      Extract<AreaResourceTargetV1, { kind: "worktree" }>,
      Extract<SuggestionEvidenceV1, { kind: "legacy-area-binding"; field: "Worktree" }>
    >;

type LegacyResourceReview =
  | (LegacyResourceCandidate & {
      state: "candidate";
      declaredBranch: string | null;
    })
  | {
      state: "invalid";
      owner: AreaPath;
      field: "Repository" | "Worktree" | "Branch";
      message: string;
    };

type ResourceProjectionCounts =
  | {
      state: "current";
      confirmedAssociations: number;
      suggestions: number;
      legacyReview: number;
    }
  | {
      state: "lower-bound";
      confirmedAssociationsAtLeast: number;
      suggestionsAtLeast: number;
      legacyReviewAtLeast: number;
    };

type AreaResourcePanelProjection =
  | {
      state: "current";
      rows: readonly AreaResourcePanelRow[];
      catalogs: readonly CatalogRevision[];
      legacyReview: readonly LegacyResourceReview[];
      suggestions: readonly ResourceSuggestion[];
      counts: Extract<ResourceProjectionCounts, { state: "current" }>;
    }
  | {
      state: "partial";
      rows: readonly AreaResourcePanelRow[];
      catalogs: readonly CatalogRevision[];
      legacyReview: readonly LegacyResourceReview[];
      suggestions: readonly ResourceSuggestion[];
      counts: Extract<ResourceProjectionCounts, { state: "lower-bound" }>;
      problems: readonly AreaResourceReadProblem[];
    }
  | { state: "unavailable"; error: CatalogReadError };

type AreaResourceResolution =
  | { state: "current"; value: AreaResourceEntity }
  | { state: "gone"; value: GoneResourceEntity }
  | { state: "unavailable"; locator: ResourceLocator; error: CatalogReadError };
```

The union keeps local state and provider lifecycle independent. A failed provider check cannot change local target state.

The canonical entity has no selected-Area scope. Only the panel row contains relation, suppression provenance, and launch-match facts.

A source-scene failure makes representation unavailable. It never becomes Never placed or Hidden.

An Area-note failure makes launch match unavailable. It never becomes false.

The exact catalog target still enables Copy or Open. Placement and mutation for an affected unknown representation wait for a current source read.

A projection is `current` only when every returned derived fact is current.

Any unavailable row fact forces `partial` and adds one matching owner-and-source problem. The lower-bound count rule then applies.

`origin.declaredBranch` is the single legacy-branch authority. A derived reader exposes it only when the origin is `legacy-area-binding`.

A tombstone resolves to `gone` with its persisted last-known target.
A valid catalog with no named ID resolves to `gone` with reason `missing-record` and no invented target.

An available composed source whose owner no longer exists resolves to `gone` with reason `missing-owner`.

The resolver does not turn that loaded source into `area-not-found`. It uses the source origin and retained Last-known projection without inventing catalog authority.

It offers **Add target to another Area** only when a last-known target exists. That action creates a normal new association and new placement.

A gone panel row is direct, has no `alsoFrom` owners, and has `viewedFrom === entity.locator.owner`.

It represents a visible removed or missing-record ghost. A missing owner has no Resources panel, and tombstones never flow to descendants.

Malformed and unsupported catalogs resolve to `unavailable`. The Map renders that result as `unresolved`, not `gone`.

GitHub `Merged` and Phabricator `Accepted` map to `success`. `Closed` and `Abandoned` map to `muted`.

Known open, draft, and review-needed states map to `neutral`. A new valid exact provider label remains visible and neutral.

An invalid or missing provider label produces `provider-state-unsupported`. It never maps to `Closed`.

The success rail, accessible name, search text, action label, and fallback label are presentation facts.

The Map projects these facts without changing source scene bytes. The resource fact revision stays separate from `worldRevision`.

### Local observations and provider reader interfaces

Agent Shell owns observation policy. The Map does not call Git or a provider.

`@tangent/repo` gains one public, read-only Git helper:

```ts
type GitWorktree = {
  path: string;
  checkout: GitCheckout;
  locked: { reason: string | null } | null;
  prunable: { reason: string | null } | null;
};

declare function listGitWorktrees(
  repository: string,
  options: { signal: AbortSignal },
): Promise<GitWorktree[]>;

type GitOptions = {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};
```

The helper parses `git worktree list --porcelain -z`. It reports Git facts and no Area policy.

`@tangent/repo` extends its own public `git`, `gitText`, and `gitRaw` options with `signal`.

Its existing `execFile` and `spawn` paths terminate the Git child on abort. Repo does not import `@tangent/agent-runtime`.

The observed checkout has 45 worktree stanzas. All have a branch, but the parser must also support detached, bare, locked, and prunable forms.

Branch and detached checkouts are candidate sources. A locked checkout stays a read-only candidate.

Bare and prunable entries are excluded from candidates and returned as named source diagnostics. A detached checkout uses the folder-name label fallback.

Agent Shell applies discovery limits, evidence, and Area policy after this helper returns.

Provider classification uses a closed recognition configuration:

```ts
type ReviewRecognition = {
  githubHost: "github.com";
  phabricatorBaseUrls: readonly HttpUrl[];
};
```

GitHub recognition accepts the `github.com` pull-request URL shape. Phabricator recognition accepts only configured, trusted base URLs.

Status support uses two named provider reader interfaces:

```ts
interface GitHubPullRequestReader {
  read(
    ref: { owner: string; repository: string; number: number },
    options: { signal: AbortSignal },
  ): Promise<ProviderReadResult>;
}

interface PhabricatorRevisionReader {
  read(
    ref: { baseUrl: HttpUrl; revisionId: `D${number}` },
    options: { signal: AbortSignal },
  ): Promise<ProviderReadResult>;
}

type ProviderReadResult =
  | { state: "current"; stateLabel: string; providerUpdatedAt: string }
  | { state: "error"; error: ProviderReadError };
```

There is no provider registry. Adding another provider requires one new union arm, one reader interface, and one treatment mapper.

Each reader preserves the provider's exact lifecycle label. Agent Shell derives treatment without narrowing that label to a local provider enum.

Expected access and upstream failures return the typed reader error. The coordinator owns timeout, label validation, and cache-capacity errors.

A valid label is non-empty, has no control characters, and is at most 100 characters. Other values produce `provider-state-unsupported`.

An unrecognized URL stays a generic Link. It never shows `Status unavailable` because no lifecycle applies.

The server composition supplies credentials to a reader. The Map, catalog, API errors, and telemetry never receive credentials.

No provider reader exists in this repository today. Provider status remains disabled until a trusted composition supplies each reader interface.

Missing provider capability is `Status unavailable`, not `Closed`. Permission errors never expose credential text.

### Map reference and representation contract

A persisted resource Block uses one new semantic kind:

```ts
type PersistedMapResourceRef = {
  kind: "resource";
  ref: ResourceId;
};
```

The source shard supplies the owner for the runtime `ResourceLocator`.

An absolute path or URL never enters `customData.tangent.ref` for a catalog resource.

The source owner must equal the catalog owner. A resource Block under `@root` is invalid.

A generic Link under `@root` cannot use in-place association. Julian chooses an Area, adds the Link there, and places a new resource Block.

At most one source Block, visible or hidden, can reference one resource locator. This rule does not change generic Link duplicate behavior.

The server validates this invariant during a Map gesture. Client-side checks only improve feedback.

A placement gesture must find one active resource in that owner catalog. A geometry edit can retain a `gone` reference.

The existing scene reader has a closed kind set. Existing validation rejects a scene that contains an unknown kind.

Therefore, a compatibility release must teach every reader and validator about `resource` before any writer emits it.

The `resource` kind remains valid when no catalog fact is available. It renders as unresolved or `gone` instead of invalidating the shard.

Catalog facts do not enter `area-map-world.v1`. They cannot change `treeRevision`, `worldRevision`, or a shard hash.

The controller collects resource locators from composed origins. A separate resource resolver supplies facts to the existing fact-refresh path.

Current Hide removes an element from the next source mutation. That behavior cannot support **Restore on Map**.

Resource Hide keeps the Block and its bound label as `isDeleted` records in the owning source shard.

Composition excludes these records. The representation reader inspects the raw source scene and reports `hidden`.

The source split and persistence merge retain deleted resource records during unrelated edits. Other deleted Excalidraw elements keep their current behavior.

Restore changes the retained resource records back to visible records. It reuses their geometry, style, group, binding, and z-order facts.

Before Restore creates a source gesture, the controller materializes the retained Block and label with their source origins into the editor.

Excalidraw history can then undo that Restore without inventing new geometry or bindings.

Hide and Restore remain Map commands and Map history entries. They never change catalog history.

Removal changes only the catalog record to a tombstone. The Block remains visible and resolves as `gone`.

The success rail is an ephemeral projection element. Fact projection excludes it from authored fingerprints, source split, Map history, and persistence.

### Typed Map entities and actions

One resolver converts persisted metadata and live facts into an exhaustive browser model:

```ts
type ExistingMapKind =
  | "goal"
  | "document"
  | "area"
  | "brain"
  | "agent"
  | "person"
  | "request"
  | "commit"
  | "evidence";

type MapEntityAction =
  | { kind: "copy-path"; resource: ResourceLocator; path: AbsolutePath }
  | { kind: "copy-url"; resource: ResourceLocator | null; url: SafeExternalUrl; targetLabel: string }
  | { kind: "open-url"; resource: ResourceLocator | null; url: SafeExternalUrl; targetLabel: string }
  | { kind: "open-document"; file: VaultFile; subpath: VaultSubpath | null; mode: "open" | "read" }
  | { kind: "open-goal"; file: VaultFile }
  | { kind: "open-area-brain"; area: AreaPath };

type MapChromeAction = {
  kind: "open-work-lens";
  area: AreaPath;
  mode: "all" | "for-you" | "problems";
};

type ResolvedMapEntity = {
  source: { owner: AreaPath | "@root"; sourceId: string };
  reference:
    | { kind: "resource"; resource: ResourceLocator }
    | { kind: "link"; url: SafeExternalUrl }
    | { kind: "vault"; entityKind: ExistingMapKind; ref: string };
  display: {
    kindLabel: string;
    label: string;
    targetClue: string;
    stateText: readonly string[];
    externalTreatment: "success" | "neutral" | "muted" | null;
  };
  accessibleName: string;
  searchText: string;
  primaryAction: MapEntityAction | null;
  readAction: MapEntityAction | null;
  sourceState: "current" | "gone" | "unresolved";
};

type MapActionOutcome =
  | { kind: "done" }
  | {
      kind: "clipboard-blocked";
      copy: { kind: "path"; value: AbsolutePath } | { kind: "url"; value: SafeExternalUrl };
    }
  | { kind: "popup-blocked"; url: SafeExternalUrl; targetLabel: string }
  | { kind: "unavailable" };
```

`resolveMapEntity` is pure. It never reads the clipboard, opens a window, navigates, or mutates the Map.

`runMapEntityAction` owns browser effects. It returns a typed outcome for the shared recovery surface.

The action payload comes from a validated catalog projection or vault projection. Bound Block text is never an action authority.

The success rail appears only when `externalTreatment` is `success`. Closed and abandoned states retain the `muted` treatment without label parsing.

The executor opens a URL synchronously inside the activation event. It does not wait for a provider refresh.

The executor synchronously opens a blank `_blank` window and checks that handle before user activation ends.

It sets `handle.opener = null`, then calls `handle.location.replace(validatedUrl)`. A missing handle is the blocked-popup result.

If navigation throws, it closes the blank handle and uses the same recovery. Copy writes the exact path or URL with no newline.

The Map owns the clipboard and blocked-popup dialogs. No action outcome changes Map save state or history.

The current raw `{ verb, kind, ref }` callback ends. The inline Area Map and composed Map use the same resolver and executor.

Work-lens controls use `MapChromeAction`. They are typed chrome commands, not entity primary actions.

Generic Links use their composed source owner for Focus, fold, and association. They no longer use the current Area-neutral `areaForBlock()` result.

These callers use the same `primaryAction`:

- The visible selected action.
- Enter on one selected Block.
- A double-click on that same selected Block.
- Enter on one resource Outline row.

The selection helper returns an entity only when exactly one total Map element is selected.

One Block plus ink returns no semantic action. The helper does not search for the first semantic element in a larger selection.

For a local resource, `o` is consumed and returns no action. `Command-C` remains an Excalidraw command.

For one selected Link, `o` invokes the same `open-url` action as Enter. Other entity kinds keep their settled `o` behavior.

Text input, composition, a modal, Work, and the terminal retain their existing higher keyboard priority.

### Resource APIs

The APIs remain private loopback contracts in Agent Shell. They do not become public package exports.

`GET /api/areas/map-resources?area=<area>` returns the selected panel projection.

The response contains direct rows, inherited rows, provenance, representation state, legacy review, Knowledge suggestions, and cached observations.

Its confirmed count includes every active association identity before a direct row suppresses an inherited display match.

Its Suggestion count covers the returned Knowledge Suggestions. Legacy-review rows keep their separate review count and state.

A partial projection returns lower bounds, not exact counts. The Area page shows **At least _N_** with the source problem.

It never presents a partial zero as an exact empty state.

The GET reads catalogs, Area notes, relevant raw source shards, and cached observations.

It does not start Git, Attempt-history, filesystem, or provider work.

An ancestor catalog error produces a partial response with a named source problem. A direct catalog error blocks mutation and prevents a false empty state.

An Area-note or source-scene failure also produces a source-owned partial problem. A legacy scan failure never becomes an empty review.

`POST /api/areas/map-resources/resolve` accepts at most 500 resource locators from loaded Map Blocks.

It returns one ordered resolution for each locator, plus current catalog revisions and cached observations. It does not start an observation.

`POST /api/areas/map-resources/refresh` checks at most 500 current resource locators. It returns one ordered result for each locator.

Refresh runs at most eight observations at once. Each observation has a 10-second abort deadline, and the route has an 18-second deadline.

`POST /api/areas/map-resources/discover` performs the explicit bounded discovery workflow.

The browser shows **Checking** for each requested source before it sends the request.
The server returns one terminal, all-settled response after every source succeeds, fails, or times out.

All discovery Git processes share four slots, including repository lists and Attempt-root checks.

Discovery has an 18-second route deadline. It returns all successes and named problems together.

`POST /api/areas/map-resources/inspect-target` validates and normalizes one form target before Save:

```ts
type TargetInspectionRequest =
  | { kind: "worktree" | "repository"; path: string }
  | { kind: "link"; url: string };

type TargetInspection =
  | {
      kind: "local";
      normalized: Extract<AreaResourceTargetV1, { kind: "worktree" | "repository" }>;
      targetFingerprint: string;
      state: "available" | "missing" | "access-denied";
    }
  | {
      kind: "link";
      normalized: Extract<AreaResourceTargetV1, { kind: "link" }>;
      targetFingerprint: string;
      state: "valid";
    };

type LocalResourceTargetInput<
  K extends "worktree" | "repository" = "worktree" | "repository",
> = {
  target: Extract<AreaResourceTargetV1, { kind: K }>;
  missingConfirmation: { targetFingerprint: string } | null;
};

type LinkResourceTargetInput = {
  target: Extract<AreaResourceTargetV1, { kind: "link" }>;
  missingConfirmation?: never;
};

type ResourceTargetInput = LocalResourceTargetInput | LinkResourceTargetInput;
```

The form shows `normalized` as the exact Copy path or Open URL before Save.

The server checks the target again during mutation. A now-missing path needs a matching confirmation for that normalized target fingerprint.

If an available path becomes missing, Save returns `missing-target-confirmation-required`. If a confirmed missing path appears, Save can continue.

The filesystem can change after commit. The observation refresh then reports its current state without changing catalog authority.

`POST /api/areas/map-resources/apply` accepts one revision-fenced mutation command:

```ts
type AtLeastOne<T> = readonly [T, ...T[]];

type AddSuggestionSelection =
  | {
      suggestion: Extract<ResourceSuggestionReference, { target: { kind: "link" } }>;
      input: LinkResourceTargetInput;
    }
  | {
      suggestion: Extract<ResourceSuggestionReference, { target: { kind: "local-path" } }>;
      input: LocalResourceTargetInput;
    }
  | {
      suggestion: Extract<ResourceSuggestionReference, { target: { kind: "worktree" } }>;
      input: LocalResourceTargetInput<"worktree">;
    };

type CatalogOnlyResourceMutation =
  | { kind: "add"; owner: AreaPath; input: ResourceTargetInput; label: string | null }
  | {
      kind: "add-suggestion";
      selection: AddSuggestionSelection;
      labelForNewRecord: string | null;
    }
  | { kind: "edit"; resource: ResourceLocator; input: ResourceTargetInput; label: string | null }
  | { kind: "remove"; resource: ResourceLocator }
  | { kind: "import-legacy"; selections: AtLeastOne<LegacySelection> }
  | { kind: "dismiss-suggestion"; suggestion: ResourceSuggestionReference };

type SceneCoupledResourceMutation =
  | { kind: "associate-generic-link"; owner: AreaPath; sourceElementId: string; labelForNewRecord: string | null }
  | {
      kind: "add-back-gone";
      oldResource: ResourceLocator;
      source:
        | { kind: "tombstone" }
        | { kind: "confirmed-last-known"; input: ResourceTargetInput; label: string };
    };

type LegacySelection = {
  candidate: LegacyResourceReference;
  attachDeclaredBranch: boolean;
};

type CatalogExpectation = CatalogRevision;
type SceneExpectation = { owner: AreaPath; hash: string | null };
type SerializedAreaCanvas = string & { readonly __serializedAreaCanvas: unique symbol };

type ResourceMutationRequestBase = {
  schema: "area-map-resource-mutation.v1";
  operationId: string;
  viewedFrom: AreaPath;
};

type ResourceMutationRequest = ResourceMutationRequestBase & (
  | {
      mutation: CatalogOnlyResourceMutation;
      expectedCatalogs: AtLeastOne<CatalogExpectation>;
      expectedScenes?: never;
    }
  | {
      mutation: SceneCoupledResourceMutation;
      expectedCatalogs: AtLeastOne<CatalogExpectation>;
      expectedScenes: readonly [SceneExpectation];
    }
  | {
      mutation: { kind: "undo"; token: string };
      expectedCatalogs?: never;
      expectedScenes?: never;
    }
);

type ResourceMutationResult = {
  operationId: string;
  catalogRevisions: readonly CatalogExpectation[];
  projection: AreaResourcePanelProjection;
  warnings: readonly ResourceWarning[];
  sourceUpdates: readonly {
    owner: AreaPath;
    serializedSource: SerializedAreaCanvas;
    hash: string;
    treeRevision: string;
    worldRevision: string;
  }[];
  undo: { state: "available"; token: string } | { state: "unavailable" };
};
```

Add, Edit, Remove, and Dismiss usually change one catalog file. A reviewed import can change several owner catalogs atomically.

The server validates `viewedFrom` as the current selected Area. It builds the returned panel projection from that Area after commit.

Associate generic Link changes one catalog and one scene shard. Add back changes one catalog and one exact Block reference.

The server uses the existing exact vault transaction for every catalog write. That boundary supplies locking, operation receipts, path-limited commits, and crash recovery.

The transaction plans from current bytes while it holds the lock. It checks only the named catalog revisions and scene hashes.

The server derives the required owner set. Expectations name each affected catalog exactly once and no other catalog.

A scene expectation must name the exact semantic source owner. Extra, missing, duplicate, or mismatched owners are invalid.

For association, the server derives the URL from the current generic Link metadata.

For tombstone Add back, it derives the old target from the tombstone. A missing-record Add back requires the explicitly confirmed Last-known input.

Missing-owner ghosts cannot use Add back. Their action creates a normal resource in a chosen Area and starts a separate new placement.

Add Suggestion, Import, and Dismiss use the supplied evidence tuple as a lookup and decision baseline.

The server rederives current legacy and Knowledge evidence. It validates Attempt and Git evidence structure and the normalized target fingerprint.

Link and discovered-Worktree inputs must match the Suggestion target. A `local-path` input can choose only Worktree or Repository for the same path.

An empty or duplicate legacy selection is invalid. If one Branch can match several selected local targets, exactly one selection attaches it.

The server never guesses a Branch target. Missing or multiple choices return `legacy-branch-choice-required`.

When one selected local target matches, that selection must attach the Branch. When none match, every selection leaves it unattached.

Read-only catalog and scene joins use `areaMapTransactions.withRead`. They cannot observe half of a multi-target install.

The plan captures every selected owner note and every ancestor note consulted by `hiddenAreaStatus` as exact guard paths.

Multi-owner import guards every note that supplied legacy evidence. Changed or missing evidence aborts with `suggestion-changed`.

The transaction rechecks those bytes and the prepared vault head immediately before install. A concurrent done or archive change aborts the write.

Guarded catalog changes map to `catalog-revision-changed`. Guarded scene changes map to `resource-representation-conflict`.

Changed legacy or Knowledge evidence maps to `suggestion-changed`. A newly hidden status maps to `area-resource-read-only`.

For an unrelated vault commit or an owner-note change that preserves status and evidence, the server performs one bounded internal replan.

If that replan cannot install, it returns the matching conflict. Interrupted install or required recovery maps to `resource-transaction-recovery`.

An Area whose nearest status is done or archived is read-only. This rule also applies to its descendants.

Resource placement preflight uses the same lock. A concurrent Remove cannot race a new placement into an invalid result.

A new or changed resource reference requires an active same-owner catalog record and no visible or hidden duplicate.

A pre-existing unresolved or tombstoned reference can survive geometry, style, and Hide edits. Generic copy and duplicate operations cannot create a second resource reference.

An inert compatibility reader gives an unresolved resource no document or URL action.

Eligible Add, Edit, Remove, association, and Add-back responses include current projections, revisions, and one opaque Undo token.

The Agent Shell server resource-mutation coordinator keeps one current in-memory Undo receipt for the retained shell process.

The durable exact transaction result never stores or reissues an Undo token. The coordinator decorates a fresh result after commit.

A same-operation replay in that process can return the same current token. After a server restart, the durable replay returns `undo: unavailable`.

The receipt contains the exact catalog inverse, its post-mutation revisions, and any semantic source inverse.

Any later catalog mutation replaces or clears that receipt, including a mutation in another Area.

A successful Area move also clears it because the receipt contains old owner paths.

The catalog revision check rejects an external catalog byte change. A server restart removes the receipt.

For association and Add-back Undo, the transaction rereads the current source shard under the lock.

It requires the exact element to keep the expected semantic resource reference. It then rewrites only that metadata on current scene bytes.

Later geometry, style, and unrelated scene edits remain unchanged. Undo conflicts only when the catalog revision or that semantic element reference changed.

This rule matches the immediate, retained-session Undo contract. Undo never trusts inverse resource bytes from the browser.

The same `operationId` can repeat after a lost response. A different request with that ID returns `operation-id-reused`.

A committed replay rebuilds its projection and source updates from a current `withRead` snapshot.

It returns the original committed effect with current authoritative bytes and revisions. It never replays stale response bytes from the durable manifest.

The browser never retries a catalog mutation with a new ID without Julian's action. Read, discovery, and observation calls are safe to retry.

For a scene-coupled mutation, the browser pauses source persistence and flushes any pending Map gesture first.

It sends the acknowledged source hash. The result returns each authoritative changed source, hash, tree revision, and world revision.

The retained Map controller installs those source updates without a Map history entry, then resumes persistence.

Association, Add back, and their Undo cannot leave pending source bytes that overwrite the transaction result.

If the owner already has the generic Link target and that resource has no Block, association reuses its ID.

Reuse preserves the existing catalog label. The associated Block adopts that label in projection, even when its former generic text differs.

`labelForNewRecord` applies only when association creates the record.

If the existing resource already has a visible or hidden Block, association returns `duplicate-resource-target` and leaves the generic Link unchanged.

`/api/areas/show` receives one additive discriminated `mapResources` field:

```ts
type AreaShowMapResourceRow = {
  locator: ResourceLocator;
  label: string;
  target: AreaResourceTargetV1;
  source: { kind: "direct" } | { kind: "inherited"; sourceArea: AreaPath };
  origin: AreaResourceRecordV1["origin"];
};

type AreaShowMapResources =
  | { state: "current"; rows: readonly AreaShowMapResourceRow[] }
  | { state: "partial"; rows: readonly AreaShowMapResourceRow[]; problems: readonly CatalogReadError[] }
  | { state: "unavailable"; error: CatalogReadError };
```

Existing `resources`, `resolved`, and `workFolder` fields remain exact.

Area-show reads only active catalog associations. It does not copy the panel's Suggestions, scene representation, or cached observations.

The CLI prints **Map resources** separately with source-Area provenance. It does not run discovery or provider checks.

This additive field gives a Brain the same active direct and inherited list. It does not rewrite the Area note or inject provider credentials.

### Mutation errors

Errors keep stable codes so the browser does not parse message text:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid-resource-request` | The request shape or operation ID is invalid. |
| 404 | `area-not-found` or `resource-not-found` | The exact owner or association does not exist. |
| 409 | `catalog-revision-changed` | At least one exact catalog changed. |
| 409 | `catalog-invalid` or `catalog-unsupported` | A catalog cannot be safely read and rewritten. |
| 409 | `resource-source-invalid` | A required Area note or source scene is invalid. |
| 409 | `duplicate-resource-target` | One active direct record already owns the same kind and target. |
| 409 | `missing-target-confirmation-required` | A local target is now missing and needs explicit confirmation. |
| 409 | `legacy-branch-choice-required` | A legacy Branch has no one selected target. |
| 409 | `suggestion-changed` | Reviewed evidence changed or disappeared before commit. |
| 409 | `resource-representation-conflict` | Placement, hidden state, or a scene hash changed. |
| 409 | `operation-id-reused` | The operation ID names different content. |
| 409 | `undo-unavailable` | No current process receipt owns this token. |
| 409 | `undo-stale` | The catalog or semantic source reference changed after the receipt. |
| 422 | `invalid-resource-target` | A path, URL, resource ID, or owner relation is unsafe. |
| 422 | `inherited-resource-read-only` | A descendant tried to mutate an ancestor record. |
| 423 | `area-resource-read-only` | The owning Area or one of its ancestors is done or archived. |
| 503 | `catalog-load-failed` | The server failed to read current catalog bytes. |
| 503 | `resource-source-load-failed` | The server failed to read a required Area note or source scene. |
| 503 | `resource-transaction-recovery` | Exact vault recovery must finish before a write. |

The existing `ApiError` transport carries the status, code, operation ID, and safe payload.

Recovery payloads use a closed union:

```ts
type ResourceMutationRecovery =
  | {
      code: "duplicate-resource-target";
      existing: ResourceLocator;
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "catalog-revision-changed" | "suggestion-changed";
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "missing-target-confirmation-required";
      inspection: TargetInspection & { kind: "local"; state: "missing" };
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "legacy-branch-choice-required";
      choices: readonly {
        owner: AreaPath;
        field: "Repository" | "Worktree";
        targetFingerprint: string;
        label: string;
      }[];
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "resource-representation-conflict";
      currentScenes: readonly SceneExpectation[];
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "resource-source-load-failed";
      problem: Extract<ResourceProjectionError, { code: "resource-source-load-failed" }>;
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "resource-source-invalid";
      problem: Extract<ResourceProjectionError, { code: "resource-source-invalid" }>;
      projection: AreaResourcePanelProjection;
    }
  | {
      code: "undo-unavailable" | "undo-stale";
      projection: AreaResourcePanelProjection;
    };
```

Other codes carry no recovery bag. The browser switches on the code instead of testing optional fields.

On conflict, the browser keeps the draft, selected Block, camera, and dialog state. The typed recovery replaces only stale read facts.

Duplicate recovery uses `existing` for **Open resource** and the returned representation for **Show on Map**.

A note or scene failure after GET returns its source-owned code. It never becomes a catalog error or a representation conflict.

An error payload never includes provider response bodies, credentials, or an unrequested target from another Area.

Resource telemetry contains operation kind, error code, counts, and durations. It never contains targets, labels, or provider content.

Catalog errors, observation errors, action errors, Map transport, and Map save errors remain separate state machines.

### Discovery and suggestion evidence

Discovery reads durable Job history, not live tmux sessions or the Work projection.

Live session discovery contains only owned, running sessions. Its `cwd` is a runtime fact and cannot prove Area membership.

The current `readAllPipelines()` view contains only the current run. Discovery must read every `job.v1` run.

The Attempt source algorithm is exact:

1. Select Jobs whose exact `job.area` equals the selected Area.
2. Flatten every `runs[].assignments[].attempts[]` record.
3. Reject records without a valid `startedAt` or `cwd`.
4. Keep records from the last 30 days.
5. Sort them newest first and keep 20.
6. Resolve each Attempt folder to its Git root.
7. Propose the root only when Git identifies it as a worktree root.

The date and count limits apply before target de-duplication. Each candidate retains Goal, run, Assignment, and Attempt evidence.

A nested Attempt folder is evidence for its Git root. The nested folder itself is not labeled as a worktree.

The current Area move does not rewrite Job records outside the vault. Therefore, pre-move Attempts with the old exact `job.area` stop contributing.

Catalog associations and repository worktree discovery move with the Area and remain available. Cross-move Job history is an accepted first-release limit.

Repository discovery uses active direct and inherited Repository targets for the selected Area.

Each repository calls `listGitWorktrees`. Agent Shell then applies duplicate, evidence, and dismissal rules.

One failed repository does not remove candidates from another repository. Each source returns `complete`, `partial`, or `error`.

The current JSON reader silently skips malformed Job files. Discovery cannot use that reader for an empty claim.

Implementation must add a result-bearing Job evidence reader. It returns valid Jobs and one problem for each unreadable record.

Knowledge scanning is conservative. It reads only the exact Area note and never writes it.

A line becomes a Suggestion only when it contains one unambiguous HTTP(S), absolute, or home-relative path target.

The suggestion includes the exact source line and its hash. Ambiguous lines produce no candidate.

A Knowledge URL is a Link Suggestion. A Knowledge path stays `local-path` because the note does not prove Worktree or Repository intent.

**Add to Area** requires Julian to choose Worktree or Repository for that path. The GET performs no filesystem classification.

A suggestion target fingerprint contains the suggested classification and normalized target.

The structured evidence value identifies the legacy field, Knowledge line, Attempt, or Git-worktree source independently from its current evidence hash.

Dismiss and Import store the evidence value, its evidence hash, and the target fingerprint.

**Add to Area** uses `add-suggestion`. It creates or reuses one direct association and stores the imported decision in the same transaction.

For `local-path`, the chosen confirmed kind can differ while the normalized path must match the Suggestion.

When Add Suggestion or Import reuses a direct association, it preserves that record's catalog label. Only explicit Edit renames a resource.

Changed evidence or a changed target becomes a new Suggestion. An imported legacy baseline does not return as first-load legacy review.

**Not now** writes no baseline or decision. Therefore, the same legacy row remains available for later review.

Confirmed association IDs never use the suggestion target fingerprint. Target replacement must preserve confirmed identity.

### Refresh and cache operations

The catalog and observation paths refresh independently.

The existing workspace refresh can resolve placed resource locators while the Map stays mounted. An SSE event only requests that read.

SSE never carries catalog authority. The next targeted response remains the source of truth.

The Resources panel reads its catalog projection when it opens. A mutation response can replace that local projection immediately.

The server's representation fact is the saved-source baseline. The retained Map controller overlays loaded live source origins by resource locator.

For a pending, failed, or conflicted Map save, the live overlay wins and carries the existing save state.

A cadence response cannot replace that overlay with an older On Map, Hidden, or Never placed baseline.

A save acknowledgement updates source hashes and clears matching overlay facts. **Reload saved** or discard removes the overlay and reveals the server baseline.

This overlay is browser presentation state, not catalog or scene authority. Scene-coupled resource mutations still flush it before their exact transaction.

The browser retains the last validated transport projection in the retained Map controller. A component remount does not clear it.

After a transport error, the browser marks those rows Last known and disables every resource-authority write.

Copy and Open stay available from the last validated target. Add, Edit, Remove, placement, Restore, association, and catalog Undo wait for a current catalog.

The browser starts observation refresh after a Map or Resources load. A manual action starts a forced refresh for the selected keys.

Installing a successful mutation projection also queues every new or target-changed locator that is visible in the loaded Map or panel.

The browser invalidates the old target key first. The new local or recognized-provider observation moves from Not checked to Checking under its generation fence.

Add back queues the new ID. A tombstone does not queue refresh.

The first release has no provider polling timer.

The Agent Shell server owns the observation cache. Its key is `{ owner, id, targetFingerprint, facet }`.

The cache lives for the server process and holds at most 2,000 entries. It evicts the least-recent inactive entry and never evicts active work.

If all 2,000 entries are active, the cache does not admit a new key. That key returns unavailable with retryable `observation-capacity`.

Target replacement invalidates that key before the mutation response becomes visible. A generation fence discards a late old response.

Concurrent requests for one key coalesce. A failed refresh keeps the last successful value and records a bounded error.

The cache stays outside the vault and scenes. A server restart or eviction loses the observation and returns Not checked or first-check unavailable.

The browser snapshot is not observation authority. It survives a retained browser controller only and remains Last known until a current server response replaces it.

An Area move or target change invalidates the old cache key. Server restart clears all observation facts, but browser remount does not.

The resource catalog reader runs an independent 30-second workspace cadence. Its fingerprint hashes exact catalog bytes and relevant raw source scenes.

This fingerprint is separate from the Markdown vault fingerprint. Server mutations also request the existing workspace SSE refresh.

An external catalog or scene change becomes visible by the next resource cadence. A stale response cannot re-enable mutation.

Refresh obtains the current target and target fingerprint under `areaMapTransactions.withRead`. It releases the read lease before slow I/O.

A generation fence discards a result when the target, owner path, or catalog revision changed after that lease.

Refresh uses the API bounds and `AbortSignal` defined above. It stops before the existing client deadline.

It returns partial results when one Git command or provider reader is slow. It never converts a timeout into `Missing` or `Closed`.

Local errors map as follows:

- `ENOENT` and `ENOTDIR` become `missing`.
- `EACCES` and `EPERM` become `access-denied`.
- A worktree root mismatch becomes `not-a-worktree`.
- An unknown check error becomes unavailable or Last known.

Provider authentication and authorization errors become `provider-access-unavailable`.

A generic link has no lifecycle observation. A missing provider reader produces unavailable state only for a recognized review Link.

A tombstone never starts a new local or provider observation. It can expose the retained server-cache value as Last known.

Undo Remove reactivates the ID and permits refresh. Add back creates a new ID whose observation starts at Not checked.

Refresh responses never write a catalog or scene. They never enter Map history, selection, save state, or camera state.

### Reader and writer compatibility

The new catalog follows read-old and write-new. It never dual-writes legacy note lines.

Legacy review reads exact direct `Repository` and `Worktree` declarations. The declaring Area owns each selected import.

Import reads declaration errors as errors. It does not use the current parser's `null` result as an empty success.

A selected batch uses one exact transaction across every owning catalog. A failure leaves every selected catalog unchanged.

An imported target records its evidence hash and any unambiguous declared branch. The current Git branch remains derived.

A legacy Branch attaches only when its declaring note identifies one matching selected local target. Otherwise, import asks Julian to choose.

An existing same-kind active target in the declaring catalog records an imported decision without another record.

That reviewed Import sets or replaces the record's legacy origin with the selected evidence and declared Branch.

It preserves the association ID, target, and catalog label. A later explicit Edit clears this origin.

Add Suggestion reuse never changes an existing origin.

An inherited match does not block explicit import into the declaring Area. Import creates its direct association and suppresses matching inherited rows with provenance.

No import changes Area prose, launch resolution, worker paths, or service paths.

An Area move carries `map-resources.json` and its scene. Association IDs and scene refs do not change.

The old `{ owner, id }` locator becomes stale. The moved source owner produces the new locator and invalidates old cache and draft authority.

The browser retains dirty draft content and marks it stale. It remaps the resource by stable ID when the moved projection makes that match unique.

A successful Area move clears the process-local resource Undo receipt and removes its Undo notice. The coordinator does not rewrite receipt paths.

Suggestion decisions remain valid because their evidence identities do not contain the Area path.

Pre-move Job Attempts remain at the old `job.area`. They do not contribute to discovery after the move.

Done and archived Areas keep their catalog. Reads, inheritance, Copy, Open, and Details remain available.

Catalog mutations for those Areas and descendants return `area-resource-read-only` until the nearest hidden ancestor reopens.

Old generic Link Blocks stay `{ kind: "link", ref: url }`. They retain their current action and do not become catalog resources.

Existing safe `mailto` Link refs stay in this compatibility path. Catalog Link targets remain HTTP(S) only.

Explicit association of one generic Link changes that exact Block to `{ kind: "resource", ref: id }` in the catalog transaction.

Undo restores the generic Link metadata. Geometry and style do not change.

If association created the catalog record, Undo tombstones it. If association reused an unplaced record, Undo leaves that record active and unplaced.

### Rollout and rollback

Rollout has four ordered stages:

1. Deploy the compatibility floor. Readers and validators accept an inert `resource` Block. Load, split, save, and merge preserve its visible and deleted records.
2. Deploy catalog parsing, panel reads, typed actions, and additive Area-show output. Keep resource Block writers disabled.
3. Enable catalog mutations, explicit placement, hidden-record retention, reviewed import, and discovery.
4. Enable each provider status reader only after its trusted server composition exists.

Stage 1 must reach every supported reader and writer before Stage 3 writes the first resource Block or deleted resource record.

The compatibility floor remains after later rollout. A binary older than that floor is not a safe rollback target after Stage 3.

Rollback first disables provider refresh, discovery, catalog mutation, and resource Block writes.

The compatible reader then keeps catalog-backed Blocks as current, `gone`, or unresolved ghosts. Its source round trip also preserves hidden resource records.

Rollback does not erase `map-resources.json`. It does not rewrite resource Blocks as generic Links or paths.

Legacy note behavior and existing generic Links remain usable throughout rollback.

No stage changes main, the live vault, live port `4321`, or the real tmux namespace during proof.

### Representative modules and callers

| Module or caller | Code-design responsibility |
|---|---|
| `packages/agent-shell/app/area-resource-catalog.mjs` | Parse, validate, hash, normalize, join ancestors, and build mutation plans. |
| `packages/agent-shell/app/area-resource-observations.mjs` | Cache local and provider observations with target-generation fences. |
| `packages/agent-shell/app/area-resource-discovery.mjs` | Read bounded Job evidence and Git worktree results. |
| `packages/agent-shell/app/area-resource-mutations.mjs` | Coordinate exact transactions, one process-local Undo receipt, and typed mutation results. |
| `packages/repo/src/git.ts` | Add an optional AbortSignal to Repo-owned Git execution without a package-graph change. |
| `packages/repo/src/worktree.ts` | Parse read-only Git worktree porcelain through a public helper. |
| `area-map-transaction-repository.mjs` | Commit catalog-only and catalog-plus-scene changes atomically. |
| `area-board-core.js` | Accept `resource` refs and derive display facts without source writes. |
| `area-map-world-index.mjs` | Validate owner, ID, duplicate representation, and placement preconditions. |
| `area-board.js` and world core | Retain resource-only hidden records during split and persistence. |
| `area-map-world.jsx` | Use exact selection and dispatch typed actions. |
| `shell.js` and inline Area Map | Execute the shared action union and show recovery. |
| Area show and CLI | Add a separate Map-resource projection without changing launch fields. |

The Resources panel calls the selected-Area GET. The picker consumes its active rows and places into each source owner.

The Area page lazily calls the same scoped GET for confirmed and Suggestion counts and **Open Map resources**.

It does not add a second resource summary to the Area tree or editor payload.

The Map controller resolves only locators that occur in loaded source shards. Find and Outline consume the same resolved entity index.

Unplaced resources remain in the panel and picker. They do not appear in Map Find or Outline.

### Code proof boundaries

Schema proof covers missing, valid, malformed, unsupported, and additive-field catalogs.

It also covers unknown nested discriminants, additive-field preservation, every target variant, normalization, tombstones, duplicate rules, and exact-owner inheritance.

It rejects mismatched legacy origin, evidence, and target kinds. A legacy row cannot persist a dismissed decision.

API proof covers ordered 500-item resolution and refresh, 18-second route deadlines, bounded concurrency, partial GETs, and all-settled discovery.

It covers legacy-review rows, Knowledge Suggestions, association-based counts, source-owned problems, and a failed legacy scan.

Scene and note failures keep catalog rows usable for Copy and Open. They expose unavailable representation or launch facts and block affected writes.

It reviews the same Knowledge path as a Worktree and as a Repository in separate Area fixtures. The GET never guesses its kind.

Target-inspection proof covers home expansion, exact normalization, unsafe links, missing confirmation, and a path that changes before Save.

It proves that additive Area-show output cannot change legacy `resources`, `resolved`, or `workFolder` fields.

Mutation proof covers required revision combinations, stable error codes, compare-and-swap, same-ID replay, and different-content ID rejection.

It rejects empty or duplicate legacy selections and every missing, extra, duplicate, or wrong-owner expectation.

It rejects legacy evidence in Add Suggestion or Dismiss and rejects every cross-paired Suggestion evidence and target.

It proves an explicit ambiguous-Branch choice and a `suggestion-changed` race across a multi-owner import.

It proves that Add Suggestion stores its imported decision atomically with the association.

It also covers a lost response, replay in one process, replay after restart, token replacement, unavailable Undo, and stale Undo.

A delayed replay returns a current read snapshot and never installs stale durable response bytes.

Transaction proof injects prepare, commit, install, and recovery errors. Catalog and scene bytes remain at one complete side of each operation.

It proves the status guard when an Area or ancestor becomes done or archived during a mutation.

It covers catalog, scene, evidence, and status-note races, plus one unrelated vault commit that succeeds after the bounded replan.

It also makes a required note and scene unreadable after GET and proves their source-owned load or invalid error.

Scene-coupled proof flushes a pending save before association, Add back, and Undo. The returned source update lets the next ordinary gesture save without reload.

It edits geometry and style between association and Undo. The semantic inverse restores metadata and preserves those later scene facts.

It covers both generic-Link association receipts: one creates and tombstones a record, and one reuses and keeps an existing record.

The reuse fixture has a different generic label and proves association and Undo preserve each authority's label.

Suggestion and legacy reuse fixtures also preserve the existing catalog label.

Legacy reuse replaces origin with reviewed evidence and the selected declared Branch. Add Suggestion reuse leaves origin unchanged.

It covers tombstone Add back, confirmed Last-known Add back, and missing-owner creation in another Area with a new placement.

Git proof parses branched, detached, bare, locked, and prunable porcelain. It proves candidate policy, source diagnostics, and exact root handling.

It aborts and reaps a slow Git child before the discovery route returns.

Job proof covers all numbered runs, the 30-day and 20-Attempt bounds, exact Area selection, and malformed-record partial results.

Provider proof uses injected readers. It covers exact labels, treatment mapping, new neutral labels, trusted Phabricator hosts, permission errors, timeout, and late-response rejection.

Provider proof does not require live credentials or network access. A live provider acceptance check remains outside deterministic repository proof.

Map proof covers reader-first compatibility, owner checks, one live Block, hidden round trips, generic-Link association, and `gone` restart actions.

It proves that new references require current membership while geometry and Hide retain pre-existing unresolved references.

It proves that generic Links use composed source ownership for Focus, fold, association, and association Undo.

Area-move proof keeps the ID and dismissal baseline, remaps the locator, and makes the old locator stale.

It keeps dirty draft content as stale comparison state and clears the old process Undo receipt.

It also proves that pre-move Job Attempts no longer contribute while catalog and repository discovery continue.

Inventory proof retains distinct inherited identities, suppresses them only behind a direct match, and counts every confirmed association.

It renders partial confirmed, Suggestion, and legacy-review counts as lower bounds and never as exact empty counts.

It lists visible gone Blocks under **Removed from Area** and excludes hidden gone records.

Action proof sends every invocation path through one action value. It covers exact selection, copy text, null opener, blocked effects, and focus restoration.

It distinguishes a successful null-opener navigation from a popup blocker that returns no blank-window handle.

Projection proof shows that refresh changes no shard hash, world revision, history entry, geometry, style, selection, camera, or save state.

It keeps a live Place, Hide, or Restore representation over a stale cadence response during pending, failed, and conflicted saves.

It reconciles the overlay only after save acknowledgement, Reload saved, discard, or an authoritative scene-coupled source update.

Cache proof covers request coalescing, generation fences, Last known values, tombstone non-refresh, LRU eviction, server restart, and browser remount.

It proves automatic local and provider refresh after Add, Add back, Edit, Replace, and Change to Repository without a remount or manual action.

It also covers a full cache whose entries are all active and returns `observation-capacity` without overflow.

Invalidation proof changes catalog bytes outside Tangent and observes them by the next independent resource cadence.

Rollback proof disables all writers after Stage 3. The compatibility floor preserves visible and hidden resource records during unrelated saves.

Recovery proof returns the existing locator for a duplicate and preserves draft, selection, camera, and opener state for every conflict.

System proof uses a temporary vault, temporary Git repositories, an isolated tmux socket, and a random loopback port.

No proof starts a preview controller against the real vault. No proof touches port `4321` or the real tmux namespace.

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
- Persist provider credentials, add background provider polling, or create a generic provider registry.
- Repair the existing difference between the public launch parser and the service-specific parser.

## Assumptions, risks, and unknowns

### Assumptions

**Assumption:** Julian wants the path copied for use in another tool. He does not want the Map to choose that tool.

**Assumption:** A trusted provider reader can report GitHub and Phabricator lifecycle with a meaningful update time.

**Assumption:** Provider Last-known state only needs the Agent Shell server process cache and the retained browser projection in the first release.

### Risks

The word **Resources** covers launch folders, free-form Knowledge, skills, commands, and more in older records.

The **Map resources** heading qualifies this panel as actionable Map targets. Toolbar context permits the shorter **Resources** action.

Status color can conflict with authored shape color. The system-owned green rail must remain visibly separate from Excalidraw style.

Discovery can reveal many worktrees. Bounded sources, provenance, dismissal, and explicit addition limit this noise.

Resource-only hidden records change the current source split behavior. Focused round-trip proof must prevent unrelated scene loss.

The observation cache is not durable. A first check after server restart or eviction can show Status unavailable.

Catalog tombstones grow without compaction in the first release. The expected manual mutation rate keeps this bounded in practice.

The current vault fingerprint ignores JSON. Every resource read must use the dedicated catalog reader and its exact byte hash.

The 30-second resource cadence leaves a bounded delay for catalog files changed outside Tangent.

Area moves do not rewrite durable Job records outside the vault. Older Attempt evidence stops matching the moved Area.

No provider status reader or credential authority exists in this repository. Provider lifecycle cannot ship before that capability exists.

The success rail must stay outside authored fingerprints. Otherwise a fact refresh can make the Map appear dirty.

### Resolved code-design questions

**Decision:** `<area>/map-resources.json` and the exact vault transaction implement catalog authority and atomic writes.

**Decision:** One revision-fenced mutation union implements Add, Edit, Remove, dismiss, import, association, Add back, and immediate Undo.

**Decision:** Two named server-side readers supply GitHub and Phabricator state. Missing readers return a typed unavailable state.

**Decision:** Provider checks run on Map load, panel load, and explicit refresh. The first release has no provider polling timer.

**Decision:** The observation cache is in memory, target-fingerprinted, generation-fenced, coalesced, and independent from Map persistence.

### Remaining implementation prerequisites

Every supported reader must accept `kind: "resource"` before a resource Block writer is enabled.

Discovery needs a result-bearing Job reader because the current JSON reader silently skips malformed records.

Each enabled review provider needs a trusted server composition, an authentication source, and an exact state-mapping acceptance check.

### Reconsider this design if

- Area Knowledge becomes a validated multi-resource authority with explicit user editing rules.
- The Map replaces Tangent Blocks with another semantic entity model.
- Single-click becomes the primary semantic action across all Map entities.
- A provider cannot supply reliable lifecycle state or update time.
- Cross-move Attempt history becomes required discovery evidence.
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

- `c0072ae58983506bd91e0f251be84a366499b77f` is the settled Product Design revision that this code design extends.
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
- `packages/agent-shell/app/area-resources.d.ts:1-28` exposes the singular legacy contract as a public package type.
- `src/cli/services.ts:93-130` contains the separate service-specific parser that compatibility must preserve.
- `packages/agent-shell/app/server.mjs:758-969` defines Areas by directories and indexes only direct Markdown Documents.
- `packages/agent-shell/app/area-map-area-move.mjs:92-164` moves every subtree file and rewrites only scene identities.
- `packages/agent-shell/app/area-map-transaction-repository.mjs:412-431` provides a read barrier for exact multi-file installs.
- `packages/agent-shell/app/area-map-transaction-repository.mjs:435-579` provides idempotent exact-target commits, locking, and crash recovery.
- `packages/agent-shell/app/vault-repository.mjs:51-109` prepares path-limited vault commits from exact in-memory bytes.
- `packages/agent-shell/app/server.mjs:1411-1432` proves that the current vault fingerprint only tracks Markdown files.
- `packages/agent-shell/app/server.mjs:1752-1761` derives done and archived state from the nearest hidden ancestor.
- `packages/agent-shell/app/public/area-board-core.js:16-260` contains Block kinds, source facts, link inference, and picker choices.
- `packages/agent-shell/app/area-canvas.mjs:50-88` rejects unknown Tangent kinds while preserving other forward element fields.
- `packages/agent-shell/app/area-map-world-index.mjs:260-323` validates safe references and reserved endpoint metadata.
- `packages/agent-shell/app/area-map-world-index.mjs:457-575` derives world revisions from Area topology and scene shards only.
- `packages/agent-shell/app/public/area-map-world-core.js:73-171` composes source ownership and excludes deleted source elements.
- `packages/agent-shell/app/public/area-board.js:91-132` removes absent visible elements through source-space Map mutations.
- `packages/agent-shell/app/public/area-map-world-controller.js:788-819` keeps Map authority separate from fact refresh.
- `packages/agent-shell/app/browser/area-map-world.jsx:469-676` contains Find, Block placement, and semantic dispatch.
- `packages/agent-shell/app/browser/area-map-world.jsx:1187-1648` contains key ownership, Outline, actions, status, picker, and help.
- `packages/agent-shell/app/area-map-world-browser.test.mjs:385-495` proves fact refresh and selection-before-action behavior.
- `packages/agent-shell/app/area-board-browser.test.mjs:683-900` proves retained and inert narrow panes and Work-lens retention.
- `packages/agent-shell/app/public/shell.js:1977-2053` contains Map entity indexing and semantic route actions.
- `packages/agent-shell/app/public/shell-event-bindings.js:900-930` contains the reusable copy and blocked-open feedback.
- `packages/agent-shell/app/public/api-client.js:1-71` carries typed status, code, retry, payload, and operation metadata.
- `packages/agent-shell/app/public/refresh-lifecycle.js:1-103` serializes refreshes and combines invalidation with the workspace cadence.
- `packages/agent-shell/app/goal-cards.mjs:3-81` contains link, copy, and review-card validation.
- `packages/agent-shell/app/area-map-proposals.mjs:1-38` provides the closest evidence-fingerprint and version-fenced suggestion precedent.
- `packages/agent-shell/app/observation-cache.mjs:1-72` coalesces reads and retains the last valid observation after an error.
- `packages/agent-shell/app/bounded-work.mjs:1-19` supplies the existing private concurrency boundary.
- `packages/agent-shell/app/job-record.mjs:41-105,797-905` distinguishes current-run views from complete immutable Job history.
- `packages/agent-shell/app/server.mjs:459-541` reads owned live sessions and their runtime working folders from tmux.
- `packages/agent-shell/app/server.mjs:3364-3386` persists Attempt working folders, provenance, time, and provider-session identity.
- `packages/agent-shell/app/server.mjs:7035-7079` and `packages/agent-shell/src/cli/commands/area.ts:149-247` define additive Area-show compatibility.
- `packages/repo/src/git.ts:1-45` owns public Git execution and currently has no AbortSignal option.
- `packages/repo/src/worktree.ts:1-81` owns worktree writes but has no read-only list helper today.
- `docs/architecture/package-boundaries.md:3-19` assigns Git and worktree helpers to Repo, and Map records to Agent Shell.
- A read-only worktree query on this checkout returned 45 stanzas across several worktree families. This variation rules out discovery as membership.

### Product evidence and precedents

- `docs/design/agent-shell-operating-vision/evidence/worker-cwd.md:79-85` records Areas whose attempts used multiple worktrees.
- `docs/design/agent-shell-brain-cards/user-intent.md:7-14` records the request for copy text, links, and Phabricator reviews.
- `docs/design/agent-shell-brain-cards/design-record.md:246-261` defines the closest copy and open action precedent.
- `ecd6d091:packages/agent-shell/app/browser/area-board-excalidraw.jsx:228-247` contains the historical Inbox and explicit Place action.
- `docs/decisions/ADR-0048-area-json-canvas-authority.md:3,37` marks that Inbox path as superseded and preserves explicit placement history.
- `docs/ui/accessibility.md:3` sets the WCAG 2.2 AA baseline.
- `docs/ui/design-principles.md:3` requires one job, visible actions, caveats, and progressive disclosure.
- `docs/ui/tokens.md:3-5` requires shared semantic tokens.
