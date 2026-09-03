# Map resources look like what they are

Product design for [[goal-map-resources-look-like-what-they-are]]. Step 1 of 3. The code design and the implementation follow this document.

Brief: `~/.tangent/trees/otto/tangent/records/brief-map-resources-look-like-what-they-are.md`. Precedent record: `docs/design/map-entities/design-record.md`.

## Revision, 2026-09-03: icons may be image files

Julian overruled the icon-format decision below: "I dont want the icons to be excalidraw drawings I want pngs or images or whatever."

`map-icons/` now accepts `.png`, `.svg`, `.webp`, `.jpg` and `.jpeg` beside `.excalidraw` and `.excalidrawlib`. Every other decision in this document stands. In particular the definition shape in `map-kinds.md` is unchanged: Julian still picks a default `icon`, an ordered `icons` list of one icon per state, and a `click` verb per entry. Only the format of the file an icon name resolves to is new, and the drawings already in his vault keep working.

The reason this document gave for rejecting images was the dark theme. That reason does not hold. Excalidraw already draws image elements through `invert(100%) hue-rotate(180deg) saturate(1.25)` when its theme is dark, which the canvas filter then undoes, so a raster icon is registered exactly as supplied. Excalidraw skips that filter for `image/svg+xml` alone, so an SVG is rasterized once to PNG, unfiltered, at no less than 512 pixels on its long edge, and joins the same path. Pre-inverting an icon's pixels the way `themeInkColor` pre-inverts drawn ink is wrong here: it cancels Excalidraw's own inversion and washes the icon out.

An image and a drawing that share one icon name is a named problem on that kind, and the image wins. A file that lies about its type or is truncated is a problem too, so the kind falls back to a card and a bad icon still never hides a Block.

Implementation: `feat(agent-shell): let Map icons be images, not only drawings`.

## Revision, 2026-09-04: the starter icon drawings are removed

Julian: "you can delete the icon drawings". Icons are image files now, so the thirteen `.excalidraw` starter drawings this document specified below are dead weight, and they are deleted with the code that wrote them.

What changed. Tangent writes no icon file at all. `map-icons/` starts absent and stays Julian's own folder: an icon exists when he puts a file in it. The starter definition Tangent writes when `map-kinds.md` is missing therefore names no icon, so a fresh vault loads its Map with every kind as a card and no problem line, and the starter prose says how to name an icon once a file is in the folder. Nothing else moved: the definition shape is the same (`id`, `label`, `target`, `icon`, `icons`, `click`), a kind with no icon still keeps its card, a `.excalidraw` or `.excalidrawlib` file Julian drops in is still read the same way beside an image, and a vault that already has `map-kinds.md`, including Julian's, is untouched.

The starter set below, and the sections that describe drawing them, are the record of what shipped on 2026-09-03. They are history, not the current behaviour.

Still open, and deliberately not fixed here: opening a Map against a vault with no `map-kinds.md` still writes and commits that one file (Goal `opening-a-map-must-not-commit-to-the-vault`).

Implementation: `feat(agent-shell): delete the starter icon drawings`.

## Decision summary

- **Decision:** A Block whose kind has an icon becomes a figure: one large hand-drawn icon with a caption beside it. The kind word leaves the caption. The icon is the recogniser.
- **Decision:** Julian controls icons and click actions in one vault Document, `~/.tangent/trees/map-kinds.md`. It has the same shape as `harnesses.md`. Worktree, repository, link, GitHub PR, Phabricator revision, and commit are entries in that Document, not cases in the renderer.
- **Decision:** An entry can name one icon per state. Tangent publishes a closed list of state names per target type. The first matching state in the entry wins.
- **Decision:** Icons live in `~/.tangent/trees/map-icons/`. Tangent writes a starter set there when the folder is empty. ~~Icons are Excalidraw drawings, not image files.~~ Superseded: see the revision above. Image files are accepted.
- **Decision:** The click action of an entry is one verb from a closed list. It runs on the existing primary-action triggers: Enter, double-click, the selected-action button, and Enter on an Outline row. A single click still selects.
- **Decision:** A figure keeps the Block footprint and the Block body. Every Area rule, placement rule, keyboard rule, and accessible name stays as it is today.
- **Decision:** A kind without an icon keeps today's card with the kind word. An error in the definition never hides a Block.

Main unresolved question for Julian: a shell command as a click action is out of this release. See "Assumptions, unknowns, and risks".

## Problem contract

### Person and intent

Julian scans the Map fast and at low zoom. He wants to know what a thing is before he reads anything. Then he wants to act on it with one gesture.

**Observed:** His words in the brief: "I want a worktree to look like a worktree. I want more than generic 'link', I want a commit which looks like a commit."

**Observed:** His generic requirement outranks icon polish. He chooses the icon, or one icon per state. He defines the click action. A new kind is a definition, not a renderer change.

### Blocked outcome

Every Block on the Map is the same blue rounded card. The kind is the first text line in capitals. Recognition needs reading.

### Observable success

- Each placeable resource kind shows a distinct icon that Julian recognises without text.
- The icon survives zoom, the dark theme, selection, drag, Area fold, Area resize, and scope changes.
- Branch, dirty or clean state, target clue, and exceptional state still read on the Block.
- The accessible name, the Outline row, Find, and every keyboard action stay unchanged.
- Julian adds or changes an icon, a state icon, or a click action by editing one vault Document. No restart. No code change.
- Julian adds a new kind with a path or URL target by editing that Document.

### Non-goals

- A new icon library dependency. The Excalidraw package already draws hand-drawn elements.
- A free-form image format for icons in this release.
- A shell command as a click action in this release.
- Any change to placement mechanics fixed at commit `077879ba`.
- A change to Area fold, containment, or resize rules.

## Current experience

**Observed:** Every Block is one Excalidraw rectangle, 280 by 132, blue stroke, light blue fill, and one bound text. Source: `packages/agent-shell/app/public/area-board-core.js`, `createBlockElements` and `blockLabel`.

**Observed:** The bound text has three lines: the kind in capitals with optional live dot and check mark, the title, and the status words. Source: `blockLabel` in the same file.

**Observed:** The kind word is the only visible difference between a WORKTREE Block and a DOCUMENT Block. Evidence: `docs/design/map-resource-icons/evidence-before.png`, taken on the `neara/delivery` Map at 50 percent zoom.

**Observed:** Resource Blocks come from the Resources panel. Their kinds today are worktree, repository, link, GitHub PR, and Phabricator revision. Source: `packages/agent-shell/app/public/area-map-entities.js`, `currentResourcePresentation` and `linkPresentation`.

**Observed:** The Block picker places goal, document, brain, agent, sub-Area, and commit Blocks. A commit Block references `vault@<sha>`. Source: `packages/agent-shell/app/public/area-board-picker.js`, line 16. Commits are placeable today, so the commit case is real.

**Observed:** The entity kinds `person`, `request`, and `evidence` exist in the kind set but nothing places them. Source: `ENTITY_KINDS` in `area-board-core.js` and the picker.

**Observed:** The Block shows for a worktree: the label, the branch as target clue, and exceptional local state (Missing, Not a worktree, Access denied, Not checked, Checking, Last known, Path status unavailable). Source: `localPresentation` in `area-map-entities.js`.

**Observed:** Dirty or clean state is not observed today. The local observation records only the checkout kind, head, and branch ref. Source: `packages/agent-shell/app/area-resource-observations.mjs`, lines 78 to 88. The brief assumes the current Block conveys dirty state. It does not. This design defines the facet and lists the observation as a prerequisite.

**Observed:** A successful provider state adds a green rail, 7 pixels wide, on the Block's left edge. The rail is an ephemeral projection element that never enters persistence or history. Source: `refreshTangentFacts` in `area-board-core.js`.

**Observed:** A gone Block changes its stroke to dashed and adds the word "gone". Source: the ghost branch of `refreshTangentFacts`.

**Observed:** A folded Area drops to 45 percent opacity. Every Block under a folded ancestor is hidden. The rail hides when its Block hides. Source: `packages/agent-shell/app/public/area-map-world-controller.js`, lines 273 to 315.

**Observed:** The Map runs the Excalidraw dark theme only. Colours are stored for the light theme and the canvas inverts them. Source: `area-map-world.jsx` line 25 and the comment at the top of `area-board-core.js`.

**Observed:** Excalidraw counter-inverts image elements in dark mode with `invert(100%) hue-rotate(180deg) saturate(1.25)`. An image keeps its natural colours while every stroke around it is inverted. Source: `node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js`.

**Observed:** The scene validator accepts `rectangle`, `diamond`, `ellipse`, `arrow`, `line`, `freedraw`, `text`, `frame`, `image`, and more. Source: `packages/agent-shell/app/area-canvas.mjs`, line 9.

**Observed:** The primary action runs from the selected-action button, Enter on one selected Block, a double-click on that Block, and Enter on one Outline row. A single click selects. Source: `docs/design/map-entities/design-record.md`, "Typed Map entities and actions".

**Observed:** Find on the Map does not match the kind word. A search for "worktree" on the `neara/delivery` Map returned "No match" while a WORKTREE Block was on the Map.

## Precedents

- **Harness registry.** `~/.tangent/trees/harnesses.md` is one vault Document with a fenced `tangent.harnesses.v2` JSON block. Every Area inherits it. An edit applies to the next launch without a restart. The Map kinds definition uses the same shape. Reason: Julian already edits one such file and knows its rules.
- **Note template.** Tangent writes a node note template when a node has none (`~/.tangent/trees/README.md`, "Node notes"). Tangent writes the starter icons and the starter definition the same way.
- **Fold opacity.** A folded Area shows at 45 percent opacity. A gone figure uses the same treatment. Reason: one meaning for one visual.
- **Success rail.** The rail proves that the system can add a decoration that never enters persistence or history. The figure's icon uses the same projection path. The rail itself retires on figures. See "Block appearance".
- **Excalidraw libraries.** An Excalidraw library item is a named group of ordinary elements. Public libraries at libraries.excalidraw.com hold thousands of hand-drawn icons. A library item is already valid scene content here. Reason: Julian gets a large catalogue and a drawing tool without a new dependency.

## Candidates

### Candidate A: one picture per kind in the renderer

The renderer maps each kind to a fixed drawing. Fast to build.

Rejected. It breaks Julian's generic requirement. A new kind or a new state icon needs a code change.

### Candidate B: an icon inside today's card

The card stays. A small icon sits in the top left corner beside the kind word.

Rejected. At 28 to 50 percent zoom the card is still a blue rectangle with a smudge. The eye sees the card first and the icon never. Julian called the card "a label, not a thing".

### Candidate C: the icon is the thing

The icon fills the Block height. The caption sits beside it. The card body becomes quiet. Selected.

Reason: at low zoom the icon is the largest shape, so the eye identifies the kind first. The caption then gives the label and state.

### Candidate D: SVG image icons

Icons are image elements from SVG files.

Rejected for this release. An image is crisp while everything around it is sketched, so it sits outside the visual language. Dark mode counter-inverts an image, so an icon in Excalidraw palette colours shows in the wrong colours beside inverted strokes. Reconsider if Julian asks for a brand mark that has no drawn form.

## Product model and language

### Terms

- **Kind:** the type of a thing on the Map: worktree, repository, link, GitHub PR, Phabricator revision, commit, goal, document, and so on. The product already uses this word in the Resources panel.
- **Map kinds definition:** the vault Document that defines each kind. Short form: the definition.
- **Icon:** one Excalidraw drawing named by its file in `~/.tangent/trees/map-icons/`.
- **State:** one word Tangent reports about a thing, such as `missing`, `dirty`, or `success`.
- **Figure:** a Block whose kind has an icon. It shows the icon and a caption.
- **Card:** a Block whose kind has no icon. It looks like today.
- **Click action:** the verb an entry names. It is the Block's primary action.

### The Map kinds definition

**Decision:** The definition is `~/.tangent/trees/map-kinds.md`. It holds prose and one fenced `tangent.map-kinds.v1` JSON block. Every Area inherits it. An edit applies on the next Map load, without a restart.

**Decision:** Tangent writes the starter definition when the file is missing. Tangent never rewrites the file after that. Julian owns it.

One entry per kind:

| Field | Meaning | Required |
|---|---|---|
| `id` | The kind id. Built-in ids: `worktree`, `repository`, `link`, `github-pr`, `phabricator-revision`, `commit`, `goal`, `document`, `area`, `brain`, `agent`. | Yes |
| `label` | The kind word in the accessible name, the Outline, and the Resources panel. | Yes |
| `target` | `path`, `url`, or `vault`. It selects the state list and the allowed verbs. | Yes for a new id |
| `provider` | `github-pr` or `phabricator-revision`. Only for `url` kinds that read provider state. | No |
| `icon` | The default icon name. | No |
| `icons` | An ordered list of `{ "when": "<state>", "icon": "<name>" }`. | No |
| `click` | The click action verb. | No |

Rules:

- If `icon` and `icons` are both absent, the kind shows as a card.
- `icons` is ordered. Tangent takes the first entry whose `when` is true for the Block. If none is true, it takes `icon`.
- `when` is one state name from the state list of the entry's target type. It can also be one provider word as the provider prints it, such as `Merged`.
- A built-in id needs no `target`. Tangent knows it. A new id needs `target` and a `label`.
- An entry that names an unknown verb, an unknown state, or a missing icon file is an error. See "Definition and icon errors".

Starter definition, written by Tangent when the file is missing:

```tangent.map-kinds.v1
{
  "version": 1,
  "kinds": [
    { "id": "worktree", "label": "Worktree", "icon": "worktree",
      "icons": [
        { "when": "missing", "icon": "worktree-missing" },
        { "when": "dirty", "icon": "worktree-dirty" }
      ],
      "click": "copy-path" },
    { "id": "repository", "label": "Repository", "icon": "repository",
      "icons": [ { "when": "missing", "icon": "repository-missing" } ],
      "click": "copy-path" },
    { "id": "link", "label": "Link", "icon": "link", "click": "open" },
    { "id": "github-pr", "label": "GitHub PR", "icon": "pull-request",
      "icons": [
        { "when": "success", "icon": "pull-request-merged" },
        { "when": "muted", "icon": "pull-request-closed" }
      ],
      "click": "open" },
    { "id": "phabricator-revision", "label": "Phabricator revision", "icon": "revision",
      "icons": [
        { "when": "success", "icon": "revision-accepted" },
        { "when": "muted", "icon": "revision-closed" }
      ],
      "click": "open" },
    { "id": "commit", "label": "Commit", "icon": "commit", "click": "open-document" }
  ]
}
```

Goal, document, area, brain, and agent are absent from the starter definition. They stay cards until Julian adds them. Reason: the brief scopes resource kinds and commits. The rule already covers every kind, so nothing blocks Julian.

### New kinds

**Decision:** A new entry with `target: "path"` or `target: "url"` is placeable. The Resources panel's Add offers every path or URL kind from the definition. The Map renderer reads only the entry's icon and click fields.

**Assumption:** The Resources panel's Add can offer a kind choice from the definition. The code design must confirm this.

**Decision:** A new `vault` kind is not placeable in this release. The vault kinds need a picker source that the definition cannot describe.

### State list

Tangent reports these states. `when` accepts only these words, plus provider words.

| Target | State | Meaning | Available today |
|---|---|---|---|
| any | `gone` | The catalog or vault record is gone. | Yes |
| any | `unresolved` | No catalog fact is available. | Yes |
| any | `duplicate` | Another Block references the same thing. | Yes |
| any | `checking` | A check is running. | Yes |
| any | `last-known` | The last check failed after a known result. | Yes |
| any | `unavailable` | No check ever succeeded. | Yes |
| `path` | `available` | The path exists. Visually quiet. | Yes |
| `path` | `missing` | The path does not exist. | Yes |
| `path` | `not-a-worktree` | The path exists but is not a git worktree. | Yes |
| `path` | `access-denied` | Tangent cannot read the path. | Yes |
| `path` | `branch` | The checkout is on a branch. | Yes |
| `path` | `detached` | The checkout is detached. | Yes |
| `path` | `bare` | The repository is bare. | Yes |
| `path` | `clean` | The working tree has no uncommitted change. | No, prerequisite |
| `path` | `dirty` | The working tree has an uncommitted change. | No, prerequisite |
| `url` | `success` | The provider reports a successful state, such as Merged or Accepted. | Yes, provider kinds |
| `url` | `neutral` | The provider reports an open or draft state. | Yes, provider kinds |
| `url` | `muted` | The provider reports a closed or abandoned state. | Yes, provider kinds |
| `url` | `unreachable` | The last fetch of the URL failed. | No, not planned here |
| `vault` | `live` | A session is live on the vault record. | Yes |

**Decision:** `dirty` and `clean` enter the observation in this Goal. The brief names dirty state as information the Block must convey. The code design owns how the observation reads it.

**Decision:** `unreachable` stays in the list as a reserved word. Nothing observes it in this release. An entry that uses it is valid and never matches.

### Click actions

**Decision:** `click` is one verb from this list. Each verb already exists as a Map action.

| Verb | What it does | Allowed targets |
|---|---|---|
| `copy-path` | Copies the exact path to the clipboard. | `path` |
| `open` | Opens the URL in a new tab. | `url` |
| `open-document` | Opens the vault Document or commit in the reader. | `vault` |
| `open-goal` | Opens the Goal. | `vault` |
| `open-brain` | Opens the Area brain. | `vault` |
| `details` | Opens the Resources panel Details for the thing. | `path`, `url` |

Rules:

- The verb runs on the existing primary-action triggers: the selected-action button, Enter on one selected Block, double-click on that Block, and Enter on one Outline row.
- A single click selects the Block. It does not run the verb. Reason: a click starts a drag on the Map, and every Block obeys that rule. Julian's words say "when he clicks it". This design reads that as the primary action, and says so here.
- The selected-action button shows the verb's label, such as "Copy path" or "Open PR".
- A verb that the target does not allow is a definition error.
- An entry without `click` keeps the kind's current primary action.
- A verb never changes Map save state or history. Its outcomes, such as a blocked clipboard, use the existing recovery surface.

Deferred: a `run` verb with a shell command template. A command has permission, progress, and recovery rules that no Map action has today. See "Assumptions, unknowns, and risks".

## Icons

### Format and location

**Decision:** An icon is one Excalidraw drawing. One file per icon in `~/.tangent/trees/map-icons/`. The file name without extension is the icon name.

Accepted files:

- `<name>.excalidraw`: an Excalidraw scene. All non-deleted elements form the icon.
- `<name>.excalidrawlib`: an Excalidraw library with one item. The item's elements form the icon.

**Decision:** Tangent writes the starter icons into the folder when it is missing or empty. Tangent never overwrites an icon file after that.

**Decision:** Tangent reads the icon folder on Map load and on each definition change. A new file needs no restart.

### The starter set

Tangent draws these icons in the Excalidraw style: black ink, roughness 1, stroke width 2, the palette colours the Map already uses. Colours are stored for the light theme like every other element.

| Icon | Drawing |
|---|---|
| `worktree` | A folder with a small tree growing out of its top edge: a trunk and a round canopy. |
| `worktree-dirty` | The same folder and tree with a pencil across the folder's front. |
| `worktree-missing` | The same folder and tree in a dashed outline with no fill. |
| `repository` | A closed book with a git fork mark on the cover: one dot that splits into two. |
| `repository-missing` | The same book in a dashed outline with no fill. |
| `link` | Two chain links joined at an angle. |
| `pull-request` | The GitHub pull-request mark: a left dot, a right dot, and an arrow that leaves the left dot and enters the right dot. |
| `pull-request-merged` | The GitHub merge mark: two dots on the left that join into one dot on the right. Purple stroke. |
| `pull-request-closed` | The pull-request mark with a cross in place of the right dot. Grey stroke. |
| `revision` | A page with a plus and a minus in its top corner, for a diff. |
| `revision-accepted` | The same page with a large check mark. Green stroke. |
| `revision-closed` | The same page with a cross. Grey stroke. |
| `commit` | The git commit mark: a line with one filled dot on it. |

**Assumption:** These metaphors are recognisable to Julian. He replaces any of them by editing the file or the definition. The design does not depend on any one drawing.

### Size, zoom, theme, and selection

- The icon is the largest shape in the figure. It fills the Block height less an inset. Around 100 by 100 in a 280 by 132 Block.
- Tangent scales the drawing to that square and keeps its aspect ratio. Julian draws at any size.
- At every zoom the icon is a vector. At 28 percent zoom it is still a shape, while the caption is not readable. That is the intent.
- The icon uses Excalidraw stroke colours. The dark theme inverts the icon with the rest of the scene. An icon drawn from a public library behaves the same way.
- The icon is not selectable on its own. Selection, hover, and the selection frame belong to the Block body. Julian cannot move, delete, or restyle only the icon.
- Excalidraw style tools apply to the Block body only. The definition owns the icon.

## Block appearance

### Figure

A figure has three parts inside the Block footprint:

1. The icon on the left.
2. The caption on the right. Line one is the label. Line two is the target clue. Line three holds exceptional state words.
3. The body: the Block rectangle. It keeps the hit area, the selection frame, arrow binding, and the containment rectangle.

**Decision:** The body of a figure is quiet: no fill and no visible stroke. The icon and caption stand alone on the canvas, like a library item that Julian placed himself.

**Decision:** The kind word leaves the caption. The icon says the kind. The accessible name, the Outline row, and the Resources panel still say the kind word.

**Decision:** The caption keeps every fact the card shows today, less the kind word: label, target clue, exceptional state, live dot, check mark, and "duplicate".

Caption examples:

| Thing | Caption |
|---|---|
| Worktree on branch, clean | `delivery` / `pgande-staging` |
| Worktree on branch, dirty | `delivery` / `pgande-staging` / `Dirty` |
| Worktree, path missing | `delivery` / `pgande-staging` / `Missing` |
| GitHub PR, merged | `Fix placement` / `neara/polez#4821` / `Merged ✓` |
| Commit | `fix(agent-shell): place Area resources` / `077879ba` |

**Decision:** A `dirty` state shows the word "Dirty" in the caption. A `clean` state shows no word. The icon can still change. Reason: the quiet default keeps the Map calm, like Available today.

### Card

A kind without an icon keeps today's card without any change. The kind word stays on the first line.

### State treatments

| State | Figure treatment |
|---|---|
| `gone` | The whole figure drops to 45 percent opacity. The caption adds "gone". Same as a folded Area. |
| `unresolved` | The figure shows the `icon` default with the caption "Map resource" and "unresolved", at 45 percent opacity. |
| `success` | The caption shows the provider word and a check mark. The state icon carries any colour. The green rail does not appear on a figure. |
| `muted` | The caption keeps the provider word. The state icon carries any grey. |
| `checking`, `last-known`, `unavailable` | Caption words only, as today. |
| `duplicate` | Caption word only, as today. |

**Decision:** The success rail retires on figures. The card keeps it. Reason: a rail beside a bare figure reads as a stray line. The text and the check mark keep the signal accessible. This departs from the map-entities record, which defined the rail for cards.

### Area rules

**Decision:** Nothing about Area rules changes. A figure is a Block. Its body is the containment rectangle that the solver already uses.

- The icon and the caption never draw outside the Block body.
- Drag, Area resize, and Area move use the body rectangle. The icon moves with it in the same frame.
- Fold hides or dims the icon with its Block. Scope hides it with its Block.
- A figure keeps the 280 by 132 footprint. Placement at commit `077879ba` does not change.

## Accessibility and keyboard

- The accessible name stays: kind label, label, states, owning Area, exact target.
- Every keyboard action stays as today. `b` opens the picker, Enter runs the primary action, `o` opens a Link, and Escape goes Back.
- The Outline row keeps the kind word. Find matches the kind word through `searchText`, which already includes it.
- Colour is never the only signal. Every state that changes an icon also changes the caption words, or already has words today.
- The icon has no required animation.

## Definition and icon errors

**Decision:** An error in the definition or in an icon file never hides a Block and never blocks the Map.

| Problem | What Julian sees |
|---|---|
| The definition file is missing | Tangent writes the starter definition and the starter icons. |
| The JSON block does not parse | Every kind shows as a card. The Map shows one notice: "Map kinds: `map-kinds.md` line N: <error>". |
| An entry names a missing icon file | That kind shows as a card. The notice names the entry and the icon. Other entries work. |
| An entry names an unknown state or verb | That entry shows as a card. The notice names the entry and the word. |
| An icon file does not parse | Kinds that use it show as a card. The notice names the file. |
| An icon has more than 200 elements | Tangent uses it and the notice warns. Reason: Map performance. |

**Decision:** The notice appears once per Map load in the Map's status area beside "Saved". It stays until Julian fixes the file. The code design picks the exact surface.

## Journeys

### Common journey: Julian scans the delivery Map

Julian opens `neara/delivery` at 50 percent zoom. He sees a folder with a tree, a book, and two cards. He knows the worktree and the repository before he reads. The worktree caption says `pgande-staging` and `Dirty`. He selects the worktree, presses Enter, and the path is on the clipboard.

### Common journey: Julian changes the dirty icon

Julian opens `~/.tangent/trees/map-icons/worktree-dirty.excalidraw` in Excalidraw, redraws it, and saves. He returns to the Map. The next Map load shows the new drawing on every dirty worktree. Nothing else changes.

### Common journey: Julian adds a kind

Julian adds an entry `{ "id": "design-file", "label": "Design file", "target": "url", "icon": "figma", "click": "open" }` to `map-kinds.md`. He drops `figma.excalidrawlib` into `map-icons/`. In the Resources panel he presses Add, chooses Design file, and pastes the URL. He places it. The Map shows the figma icon with the label. Enter opens the URL.

### Recovery journey: an icon name is wrong

Julian writes `"icon": "worktre"`. The Map shows worktrees as cards with the word WORKTREE. The status area says "Map kinds: entry worktree: icon `worktre` not found". He fixes the name. The next Map load shows figures.

### Recovery journey: a worktree is removed

Julian removes a worktree outside Tangent. The next check reports `missing`. The figure changes to the dashed folder and the caption adds "Missing". Enter still copies the path. The Resources panel offers Refresh path, Replace target, and Remove from Area, as today.

## Decisions and evidence

| Decision | Decisive evidence or trade-off |
|---|---|
| Figure, not a card with an icon | The evidence screenshot at 50 percent zoom. The card shape dominates and the text is the only difference. |
| One vault definition Document | `harnesses.md` precedent. Julian already edits this shape without a restart. |
| Icons are Excalidraw drawings | The scene validator accepts every element type. Dark mode inverts drawings with the scene and counter-inverts images. Public libraries give Julian a catalogue. |
| One icon per state, ordered | Julian's requirement. First match keeps the rule simple and puts priority in his hands. |
| Closed verb list | Every verb is an existing Map action with a typed outcome and recovery. |
| Single click selects | A click starts a drag on the Map. Every Block obeys that. |
| Body stays, quiet | The body is the containment, binding, and selection rectangle. Removing it changes Area rules, which the brief forbids. |
| Rail retires on figures | A rail beside a bare figure reads as a stray line. Words and the check mark keep the signal. |
| Kind word leaves the caption | Julian's success test. The accessible name and Outline keep the word. |
| Card stays for kinds without icons | No forced migration. The rule covers every kind when Julian wants it. |

## Rejected alternatives

- **One picture per kind in code.** Breaks the generic requirement.
- **Small icon inside the card.** Fails at low zoom.
- **SVG image icons.** Outside the hand-drawn language and wrong colours in dark mode. Reconsider on request.
- **Single click runs the action.** Conflicts with drag and with every other Block.
- **Match on provider label only.** Labels differ per provider. The treatment words `success`, `neutral`, and `muted` are stable. Provider words stay allowed as an extra.
- **Per-Area definitions.** No demonstrated need. One machine-wide Document is enough, like harnesses.
- **Definition in the repository.** Julian does not edit the repository to change his own setup. The vault is his.

## Assumptions, unknowns, and risks

### Assumptions

- The Resources panel's Add can take its kind choice from the definition.
- The starter metaphors are recognisable to Julian. He can replace any of them.
- Public Excalidraw library items parse as ordinary elements in this Excalidraw version, 0.18.1.

### Unknowns

- Whether Julian wants a shell command as a click action in this Goal. The brief says "define the action taken when he clicks it". A command needs permission, progress, and recovery rules that the map-entities record assigns to Area Operations. This design defers it and asks Julian.
- Whether a URL reachability check is wanted. `unreachable` is reserved and not observed.

### Risks

- A large icon with many elements slows the Map when many Blocks show. The 200 element warning limits it.
- A figure with a quiet body is harder to hit than a filled card. The hit area stays the full body rectangle, so the target size is the same.
- Julian's own Excalidraw restyling of a Block body no longer shows on a figure. He restyles the icon file instead.

### Reconsider this design if

- Julian asks for a brand mark that has no drawn form. Then add image icons with a stated colour rule.
- Julian asks for a `run` verb. Then design its permission and progress rules first.
- More than one machine-wide definition is needed, for example per Area. Then add an Area-level override with the same shape.

## Code boundary

The code design must resolve these points. This document does not select them.

- How the icon elements enter the composed scene: as projection elements bound to the Block, like the rail, or as a group. The product rule is that the icon is not selectable alone and never persists into the source shard.
- How the observation reads `dirty` and `clean` for a path target, and its cost per refresh.
- How the definition and the icon folder load, cache, and invalidate without a restart.
- How the Resources panel's Add reads path and URL kinds from the definition.
- Where the notice for definition errors renders.
- How `searchText` and the accessible name stay unchanged when the caption drops the kind word.

## Proof contract for implementation

- One screenshot per starter kind at 50 percent zoom beside a document card, in dark theme.
- One screenshot of a dirty worktree, a missing worktree, and a merged PR.
- A browser test that folds the Area and makes sure that the icon hides with the Block.
- A browser test that drags a figure to the Area edge and makes sure that the body stays inside.
- A test that a bad icon name yields a card and one notice.
- A test that the accessible name of a figure equals the accessible name of the same card.
- A test that Enter on a figure runs the entry's verb.

## Evidence index

- Brief: `~/.tangent/trees/otto/tangent/records/brief-map-resources-look-like-what-they-are.md`.
- Before screenshot: `docs/design/map-resource-icons/evidence-before.png`.
- Block factory and label: `packages/agent-shell/app/public/area-board-core.js`.
- Entity resolver and state words: `packages/agent-shell/app/public/area-map-entities.js`.
- Picker kinds: `packages/agent-shell/app/public/area-board-picker.js`.
- Local observation: `packages/agent-shell/app/area-resource-observations.mjs`.
- Fold and scope projection: `packages/agent-shell/app/public/area-map-world-controller.js`.
- Containment solver: `packages/agent-shell/app/public/area-map-world-core.js`.
- Scene element types: `packages/agent-shell/app/area-canvas.mjs`.
- Harness registry precedent: `~/.tangent/trees/harnesses.md`.
- Vault rules: `~/.tangent/trees/README.md`.
- Map entities record: `docs/design/map-entities/design-record.md`.
