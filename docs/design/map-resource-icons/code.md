# Map resources look like what they are: code design

Code design for [[goal-map-resources-look-like-what-they-are]]. Step 2 of 3. The product design is `docs/design/map-resource-icons/product.md`. The implementation follows this document.

Brief: `~/.tangent/trees/otto/tangent/records/brief-map-resources-look-like-what-they-are.md`. Precedent record: `docs/design/map-entities/design-record.md`.

Lenses used: architecture, types, and data. API. Migration and compatibility. Operations. Every lens applies, because the change adds a vault file format, a server route, a persisted observation field, and a render-time projection.

## Decision summary

- **Decision:** The server owns the definition and the icons. One module, `packages/agent-shell/app/map-kinds.mjs`, reads `~/.tangent/trees/map-kinds.md` and `~/.tangent/trees/map-icons/` on every request and returns one catalog: normalized kinds, normalized icons, and problems. The browser never parses an Excalidraw file.
- **Decision:** One route, `GET /api/areas/map-kinds`, serves the catalog with a revision hash. The Map fetches it on mount and on the existing 30 second resource cadence. A changed revision repaints facts. No restart.
- **Decision:** A figure is a projection. The icon elements are locked ephemeral elements that `refreshTangentFacts` adds beside the Block, like the success rail. The caption is the Block's existing bound text, laid out to the right of the icon the way region labels are laid out today. The quiet body style is projection-only and never reaches a source shard.
- **Decision:** The states that pick an icon come from one new field on the resolved entity, `states`, built in `area-map-entities.js` from the same facets that build the state words. `duplicate` joins in `refreshTangentFacts`, where the scene is known.
- **Decision:** `dirty` and `clean` come from one added Git call in `inspectLocalResource`: `git --no-optional-locks diff --quiet HEAD --`. Exit 1 is dirty. Untracked files do not count. The value gains `dirty: true | false` on every non-bare checkout.
- **Decision:** A definition kind persists in the resource catalog as an additive `kind` field on the record. The closed `target.kind` union stays `worktree`, `repository`, `link`. New kinds with `target: "url"` are placeable in this release. New kinds with `target: "path"` are accepted by the parser but are not placeable yet. See "New kinds".
- **Decision:** The click verb is resolved in `resolveMapEntity`, which now takes the catalog. A verb maps to an existing action kind. One new action kind, `details`, opens the Resources panel Details. No verb runs a command.
- **Decision:** A commit Block resolves as a current Block with the short SHA as its caption and no primary action. Today it resolves as gone. The starter `commit` entry has no `click`. See "Commit Blocks".
- **Decision:** No new dependency. Excalidraw 0.18.1, React 18.3.1, Playwright, and axe are already in the package.

Main unresolved questions for Julian: untracked files do not make a worktree dirty, and a new `path` kind is not placeable in this release. Both are listed under "Assumptions, unknowns, and risks".

## Technical contract

The product design is settled. This document changes no user-visible rule in it, except the four departures listed at the end of this document.

Observable success, in code terms:

- `refreshTangentFacts` returns a scene where each Block with a defined icon has locked icon elements inside its body rectangle and a caption without the kind word.
- The composed source shards written by `publish` contain no icon element, no quiet body style, and no caption geometry. Only the caption words persist, as today.
- The controller hides icon elements with their Block under fold, scope, semantic detail, Find, and Focus.
- `resolveMapEntity` returns the same `accessibleName` and `searchText` for a kind with an icon and the same kind without one.
- A local observation of a non-bare checkout reports `dirty` as a boolean.
- A definition edit, an icon file edit, or a new icon file shows on the next cadence tick or Map load without a server restart.
- A definition error yields cards and exactly one notice per problem in the Map status area.

Non-goals: image icons, a `run` verb, a per-Area definition, a change to placement or Area rules, a change to the resource catalog's closed target union.

## Current system

Every claim in this section is **Observed** in the worktree at commit `5bf59287`.

### Block rendering

- `createBlockElements` in `packages/agent-shell/app/public/area-board-core.js` makes one rectangle, 280 by 132, blue stroke, light blue fill, and one bound text. The text has `containerId` set to the rectangle and the rectangle lists the text in `boundElements`.
- `blockLabel` writes three lines: the kind word in capitals with the live dot and check mark, the wrapped title, and the wrapped status words. `wrapLabelLine` wraps at 26 columns.
- `refreshTangentFacts` runs on a clone of the composed scene. It removes every `resource-success-rail` element, recomputes each Block's fact, counts duplicates, rewrites the bound text words, applies ghost styling, and pushes a new rail for each successful resource. The rail is a locked rectangle with `customData.tangentWorldEphemeral = { kind, sourceId }` and `customData.tangentWorld = { owner, sourceId }`.
- For an Area region, `refreshTangentFacts` sets the bound text's `x`, `y`, `width`, `height`, `textAlign`, and `verticalAlign` by hand every projection. Excalidraw renders the bound text at those coordinates. This is the precedent for the caption layout.
- Ghost styling persists. `tangent.ghost` and `tangent.inkStrokeStyle` are written into `customData.tangent`, and the dashed stroke reaches the source shard on the next publish of that Block.
- `authoredFingerprint` ignores every element with `tangentWorldEphemeral`.
- `sceneOutline` and the Outline row use `factForBlock` and the resolved entity, never the bound text.

### Projection and hiding

- `project()` in `packages/agent-shell/app/public/area-map-world-controller.js`, lines 257 to 329, clones `composition.scene`, calls `refreshTangentFacts` with a `resourceFact` callback, then builds a hidden set. Lines 311 to 315 hide a rail when its `sourceId` is hidden. This check names the rail kind explicitly.
- The `resourceFact` callback calls `resolveMapEntity` with the resolution map and returns `{ kind, title, status, ghost, success }`.
- `setResourceResolutions` at line 845 replaces the resolution map, bumps `factsRevision`, and notifies. This is the precedent for installing the kinds catalog.
- `ephemeral(element)` in `packages/agent-shell/app/browser/area-map-world.jsx`, line 72, excludes ephemeral elements from pointer hit tests, placement obstacles, and `publish`.
- `publish` at line 2068 rebuilds source shards from the elements Excalidraw holds. `restoreMaskedElements` at line 251 replaces hidden elements with their composed values. `splitComposed` in `area-map-world-core.js` drops every ephemeral element and strips `tangentWorld` fields.
- A projected style on a Block body flows into the source shard on the next publish of that shard. Nothing in `publish` restores a body style from the composition.

### Entity resolution and actions

- `resolveMapEntity` in `packages/agent-shell/app/public/area-map-entities.js` is pure. It returns `display`, `accessibleName`, `searchText`, `primaryAction`, `readAction`, and `sourceState`. It does not return a closed state vocabulary. `localPresentation` and `lifecyclePresentation` produce words only.
- The kind label of a resource comes from `currentResourcePresentation`: `Worktree`, `Repository`, `GitHub PR`, `Phabricator revision`, or `Link`. The provider kind comes from `recognizeReviewLink` on the URL, inside the observation descriptor. Nothing persists a kind id on a catalog record.
- `dispatchMapEntity` in the JSX, line 777, runs `copy-path`, `copy-url`, and `open-url` through `runMapEntityAction`. Every other action kind goes to `dispatchShellEntityAction`, which forwards `open-goal`, `open-document`, and `open-area-brain` to the host.
- The selected-action button, Enter on one selected Block, double-click, and Enter on an Outline row all call `dispatchMapEntity(entity, entity.primaryAction)`.
- The Resources panel Details opens with `openResources(owner)` then `setResourceDetails(locator)`, JSX line 2931.

### Resource catalog and observation

- `TARGET_KINDS` in `packages/agent-shell/app/area-resource-catalog.mjs`, line 11, is `worktree`, `repository`, `link`. `validateAreaResourceCatalog` keeps additive JSON fields on records.
- `inspectLocalResource` in `packages/agent-shell/app/area-resource-observations.mjs` reads `is-bare-repository`, `show-toplevel`, `HEAD`, `symbolic-ref`, and the common dir. It never reads working tree status. The value is `{ state, checkout: { kind, head, branchRef }, repositoryPath }`.
- `gitText` in `packages/repo/src/git.ts` throws on a non-zero exit. The thrown error carries the exit code in `error.code`. `optionalGitText` already converts an allowed exit code into an empty string.
- Refresh runs with concurrency 8 and a 10 second deadline per target. The cache holds 2000 entries.
- The Map resolves its resource Blocks through `POST /api/areas/map-resources/resolve` on every world revision and refreshes observations once per Block set, then every 30 seconds through `resourceCadence` (JSX lines 510 to 567).

### Vault layout and the harness registry

- `createLaunchCatalog` in `packages/agent-shell/app/launch-catalog.mjs` reads `harnesses.md` from disk on every call with `readFile`. There is no cache and no restart. `parseHarnessRegistry` uses `fencedBlock(text, tag)` from `launch-environment.mjs`, which is exported.
- The starter registry is written through `repository.writeMarkdown` and `commit(paths, message, "machine", null)`, `launch-catalog.mjs` lines 229 to 232.
- `readTree` in `packages/agent-shell/app/server.mjs`, line 895, treats every directory as an Area except names in `TREE_SKIP` (`.git`, `.obsidian`, `shared`, `node_modules`) and names that start with a dot. A folder `map-icons` at the vault root would become an Area named `map-icons`.
- The vault root already holds `@root/@root.excalidraw`, the root Map shard. The world index filters `@root` by name.

### Commit Blocks

- The picker places `kind: "commit"` with `ref: "vault@<sha>"` and the subject as the cached title (`area-board-picker.js`, line 16).
- `factForBlock` and `resolveVault` look the ref up in the documents index. No record matches `vault@<sha>`. Every commit Block therefore resolves as `gone` with a dashed stroke and the word "gone". The cached subject is overwritten on the first projection.
- No route or reader opens a vault commit. `open-document` on a commit ref sends the host a file named `vault@<sha>`.

### Tests

- `area-board-core.test.js`, `area-map-entities.test.js`, `area-map-world-controller.test.mjs`, and `area-resource-observations.test.mjs` run under `node:test` without a browser.
- `area-map-world-browser.test.mjs` and `area-map-resources-browser.test.mjs` drive Playwright against a fixture page that serves the real bundle and a fake `options.api`. They run only with `TANGENT_BROWSER_TEST=1`. The resource pipeline test at line 1334 already proves move, growth, fold, Outline, and Find for resource Blocks.

## Precedents

- **Success rail.** A locked ephemeral element created in `refreshTangentFacts`, hidden with its Block, dropped by `splitComposed`, ignored by fingerprints and hit tests. The icon elements use the exact same fields. Reason: every consumer already handles this shape.
- **Region label layout.** A bound text positioned by hand each projection. The caption uses it. Reason: Excalidraw lays out bound text over the full container width, and this is the one proven way to place bound text beside something.
- **Region drag surface.** The controller gives regions `backgroundColor: "#ffffff01"` so a transparent shape still has a hit surface. The quiet figure body needs the same fill. Reason: Excalidraw hit-tests a transparent-fill shape on its stroke only.
- **`restoreMaskedElements`.** `publish` already replaces disposable render values with composed authority. The same step restores figure body style and caption geometry. Reason: projection-only presentation must not persist.
- **Harness registry.** Read from disk per request, fenced JSON block, starter written once through the vault repository with a machine commit. The definition follows it exactly.
- **`setResourceResolutions`.** Installs facts, bumps `factsRevision`, notifies. `setMapKinds` copies it.
- **`optionalGitText`.** Converts an expected exit code into a value. The dirty check reuses it.

## Architecture, types, and data

### Ownership

| Fact | One authority | Consumers |
|---|---|---|
| Kind entries and their icon names | `map-kinds.md` through `map-kinds.mjs` | Route, browser catalog, resolver |
| Icon drawings | `map-icons/*.excalidraw`, `*.excalidrawlib` through `map-kinds.mjs` | Route, figure projector |
| The kind id of one resource | Catalog record `kind`, else provider recognition, else `target.kind` | `resolveMapEntity` |
| The state words of one Block | `resolveMapEntity` (`states`), plus `duplicate` from `refreshTangentFacts` | Figure projector, caption |
| The click action | `resolveMapEntity` from the entry verb, else today's default | Every primary-action trigger |
| Dirty or clean | `inspectLocalResource` | Resolver, Details panel |
| Icon elements on the canvas | `refreshTangentFacts` in the projection | Excalidraw, controller hide pass |

No fact is stored twice. The browser holds the catalog only as an installed snapshot with a revision.

### Modules

New files:

- `packages/agent-shell/app/map-kinds.mjs`: parse the definition, read and normalize icons, build the catalog, write the starter. Server only.
- `packages/agent-shell/app/map-kind-starters.mjs`: the starter definition text and the thirteen starter icon scenes as data built from `createShapeElement`, `createTextElement`, and small line and freedraw primitives. Server only.
- `packages/agent-shell/app/map-kinds-routes.mjs`: `createMapKindsRoutes({ catalog })` with one GET handler.
- `packages/agent-shell/app/public/area-map-figures.js`: pure browser and node module. Icon selection, caption words, icon element creation, caption layout, quiet body, and the publish-time restore. No I/O.

Changed files:

- `public/area-board-core.js`: `refreshTangentFacts` gains `options.figures`. `blockLabel` stays for cards. `factForBlock` gains `states` and `kindId` and learns the commit ref.
- `public/area-map-entities.js`: `resolveMapEntity` gains `input.kinds`. The result gains `kindId` and `states`. Verbs map to actions. `details` action kind.
- `public/area-map-world-controller.js`: `setMapKinds`, `mapKinds` in the snapshot, generic ephemeral hiding, figure cache.
- `browser/area-map-world.jsx`: catalog fetch, `details` dispatch, notice rendering, publish-time restore, kinds passed to every `resolveMapEntity` call.
- `area-resource-observations.mjs`: dirty check.
- `area-resource-catalog.mjs`: optional `kind` field on a record. `addAreaResource` and `editAreaResource` accept it.
- `area-resource-projection.mjs`: passes `kind` through to the entity.
- `server.mjs`: `TREE_SKIP` gains `map-icons`. Wires the catalog and route.
- `~/.tangent/trees/README.md`: one line that reserves `map-icons` and names `map-kinds.md`.

Dependency direction stays as today: `map-kinds.mjs` imports `public/area-board-core.js` and `area-canvas.mjs`, like `area-canvas.mjs` already imports `area-board-core.js`. No public module imports a server module.

### The definition file

The parser reads the fenced block `tangent.map-kinds.v1`. The entry shape is the product design's table. The parser output is one normalized entry per kind:

```ts
type MapKindEntry = {
  id: string;                     // safe id: /^[a-z][a-z0-9-]{0,63}$/
  label: string;
  target: "path" | "url" | "vault";
  provider: "github-pr" | "phabricator-revision" | null;
  builtIn: boolean;
  icon: string | null;
  icons: readonly { when: string; icon: string }[];
  click: MapKindVerb | null;
  problems: readonly string[];    // non-empty means: this entry renders as a card
};

type MapKindVerb = "copy-path" | "open" | "open-document" | "open-goal" | "open-brain" | "details";
```

Built-in ids and their fixed targets:

| id | target | provider |
|---|---|---|
| `worktree` | path | |
| `repository` | path | |
| `link` | url | |
| `github-pr` | url | github-pr |
| `phabricator-revision` | url | phabricator-revision |
| `commit` | vault | |
| `goal`, `document`, `area`, `brain`, `agent` | vault | |

Rules the parser enforces, each as one problem string that names the entry:

- An unknown `id` needs `target` and `label`. A built-in `id` ignores a supplied `target` that differs and reports a problem.
- `when` must be a state word from the closed list for the entry's target, or a provider word for a provider kind. The closed list is exported as `MAP_KIND_STATES` from `area-map-figures.js` so the parser and the resolver share it.
- `click` must be a verb allowed for the target: `path` allows `copy-path` and `details`; `url` allows `open` and `details`; `vault` allows `open-document`, `open-goal`, `open-brain`.
- Every icon name must exist in the icon set. A missing name is a problem on the entry, not on the file.
- A duplicate `id` is a problem on the second entry.

A parse failure of the whole block yields `{ error: "map-kinds.md line N: <message>" }` and no entries. Line N is the line of the fenced block start plus the JSON error position, computed from the `JSON.parse` message the way Node reports it. When Node gives no position, the line is the block start.

### Icon files and the normal form

`readIcon(name, bytes)` accepts:

- `<name>.excalidraw`: `type === "excalidraw"`, `elements` array. All elements with `isDeleted !== true`.
- `<name>.excalidrawlib`: `type === "excalidrawlib"`. Version 2 needs exactly one entry in `libraryItems` and uses its `elements`. Version 1 needs exactly one entry in `library` and uses that array. More than one item is a problem on the file.

Each element passes the same per-element checks as `validateAreaCanvas`: supported type, finite geometry, safe strings. Implementation: split the per-element loop of `validateAreaCanvas` into an exported `validateSceneElements(elements)` and call it from both places. `image`, `embeddable`, and `iframe` elements are rejected in an icon with a problem, because an image needs `files` and counter-inverts in dark mode.

Normal form:

```ts
type MapIcon = {
  name: string;
  width: number;          // bounds of the non-deleted elements
  height: number;
  elements: readonly IconElement[];  // translated so the bounds start at (0, 0)
  elementCount: number;
  warning: string | null; // "more than 200 elements"
};
```

Translation uses the union of element rectangles. Line, arrow, and freedraw elements keep their `points` relative to their own `x` and `y`, so translating `x` and `y` is enough. Bound text keeps `containerId`, and containers keep `boundElements`, both with the file's ids. The projector remaps ids per instance.

Limits: more than 200 elements is a warning and the icon is used. More than 1000 elements is a problem and the icon is not used. Reason: a Map with 30 figures of 1000 elements is 30000 elements, and the scene validator caps a shard at 5000. The product design names only the warning. This is departure 2.

### The catalog

```ts
type MapKindsCatalog = {
  revision: string;                    // sha256 of the definition text and every icon file's bytes
  source: "vault" | "starter";         // starter: served from memory because the vault is not writable
  kinds: readonly MapKindEntry[];
  icons: Readonly<Record<string, MapIcon>>;
  problems: readonly { scope: "definition" | "entry" | "icon"; name: string | null; message: string }[];
};
```

The browser stores the catalog in the controller. `refreshTangentFacts` receives `figures = { kinds: Map<id, MapKindEntry>, icons: Record<name, MapIcon> }` built once per `setMapKinds`.

### The resolved entity

`ResolvedMapEntity` gains two fields:

```ts
kindId: string;            // "worktree" | "repository" | "link" | "github-pr" | "phabricator-revision" | "<definition id>" | "goal" | ...
states: readonly string[]; // closed vocabulary, in facet order
```

`states` is built from facets, never from words:

| Facet | States |
|---|---|
| Source | `gone`, `unresolved` |
| Local observation state | `checking`, `last-known`, `unavailable` (`not-checked` adds nothing) |
| Local value | `available`, `missing`, `not-a-worktree`, `access-denied` |
| Checkout | `branch`, `detached`, `bare` |
| Working tree | `dirty`, `clean` |
| Provider lifecycle state | `checking`, `last-known`, `unavailable` |
| Provider value | `success`, `neutral`, `muted`, and the provider word as printed |
| Vault record | `gone`, `live` |

`unreachable` is in `MAP_KIND_STATES` and no facet emits it.

The `resourceFact` callback in the controller passes `kindId` and `states` through. `factForBlock` for vault kinds sets `kindId = tangent.kind` and `states` from `gone` and `live`. `refreshTangentFacts` appends `duplicate` to `states` in the same place it appends the word.

### The figure in the projection

`refreshTangentFacts(scene, documents, { resourceFact, figures, figureCache })`, for each Block with a fact:

1. `entry = figures.kinds.get(fact.kindId)`. If no entry, or the entry has problems, or the entry has no icon, the Block is a card. Nothing else changes.
2. `iconName = figureIconName(entry, fact.states)`: the first `icons[i]` whose `when` is in `states`, else `entry.icon`. If the icon is absent from `figures.icons`, the Block is a card.
3. Caption words: `captionLabel(fact)` returns the wrapped title, the wrapped status, and nothing else. The live dot and check mark move to the end of the first line. Wrap columns become 18. Reason: the caption box is about 160 pixels wide at 18 pixel Excalifont.
4. Caption layout on the bound text, in projection only. `iconBox = block.height - 24`, which is 108 for a normal Block. Then `x = block.x + 14 + iconBox + 10`, `y = block.y + 12`, `width = block.width - iconBox - 38`, `height = block.height - 24`, `textAlign: "left"`, and `verticalAlign: "middle"`.
5. Quiet body, in projection only: `strokeColor: "transparent"`, `backgroundColor: "#ffffff01"`, `fillStyle: "solid"`. The Block gets a marker, `customData.tangentWorldFigure`. The marker holds the composed body style and the composed caption geometry so that `publish` can restore them.
6. Ghost figure: `opacity = 45` on the body, the text, and each icon element, in projection only. The dashed stroke bookkeeping still runs, so a ghost Block that loses its icon later still shows the dashed card. The restore step returns opacity too.
7. Icon elements: `createFigureElements(block, icon, { opacity })`, appended to the scene after the Block and its text. No rail for a figure.

`createFigureElements` produces one element per icon element:

- `id = "${block.id}-tangent-icon-${index}"`. `containerId`, `boundElements[].id`, `startBinding.elementId`, and `endBinding.elementId` are remapped through the same table. A binding to an id outside the icon becomes `null`. `groupIds` becomes `[]`. `frameId` becomes `null`. `link` becomes `null`.
- Scale `s = min(iconBox / icon.width, iconBox / icon.height)`. Origin `ox = block.x + 14`, `oy = block.y + (block.height - icon.height * s) / 2`. Each element: `x = ox + x * s`, `y = oy + y * s`, `width *= s`, `height *= s`. `points` scale by `s`. Text `fontSize *= s`. `strokeWidth` stays. Reason: a constant stroke keeps the hand-drawn weight equal across icons of different source sizes.
- `locked: true`, `isDeleted: false`, `opacity` as given, `seed` copied from the file so every instance has the same wobble, `version: 1`, `versionNonce = seedFor("${id}:${iconName}")`.
- `customData = { tangentWorldEphemeral: { kind: "resource-figure-icon", sourceId: block.id, icon: iconName }, tangentWorld: { owner, sourceId: "${sourceId}-icon-${index}" } }` when the Block has an owner, as the rail does.

`figureCache` is a `Map` the controller owns. Key: `${block.id}\0${iconName}\0${x}\0${y}\0${width}\0${height}\0${opacity}`. Value: the element array. A hit returns the same element objects, so Excalidraw's per-element shape cache and canvas cache hit as well. The controller clears the cache in `setMapKinds` and caps it at 2000 entries by deleting the oldest. Reason: `project()` runs on every notify, including drag frames. Rough shape generation for every icon element on every frame is the one cost this design adds. The cache removes that cost for every figure that did not move.

Element order: the icons are appended after the Block and its text. Excalidraw assigns fractional indices to new elements in array order, so an icon renders above its quiet body. This is the same order the rail relies on.

### Hiding

The controller's hide pass changes lines 311 to 315 from `kind === "resource-success-rail"` to any `tangentWorldEphemeral.sourceId`. Fold, scope, semantic detail, Find reveal, and Focus then hide icons with their Block through the existing `hidden` set.

### Publish-time restore

`restoreFigurePresentation(elements, composition)` in `area-map-figures.js` runs in `publish` right after `restoreMaskedElements`. For every element with `customData.tangentWorldFigure`, it copies the recorded body style and opacity back and removes the marker. It also copies the recorded caption geometry back onto the bound text. `splitComposed` still drops the icon elements.

The caption words persist, as they do today for every Block. That is the fact cache the map-entities record defines. A source shard written by this build therefore holds the caption words and today's body style and text geometry.

### Selection, zoom, and theme

- Selection: Excalidraw skips locked elements in click, marquee, and select-all hit tests. The rail proves this in the live product. The selection frame belongs to the body, whose hit surface is the full rectangle because of the near-transparent fill.
- If Julian unlocks all elements from the context menu and moves an icon, `publish` drops the icon and the next projection redraws it in place. No persistence changes.
- Zoom: icons are ordinary vector elements. No work.
- Theme: icons store light-theme colours and the dark canvas inverts them with the scene. The starter uses `#1e1e1e`, `#2f9e44`, `#9c36b5`, and `#868e96`, all from the Excalidraw palette already used in `area-board-core.js`.
- Area rules: the body rectangle is unchanged in every gesture. The icon elements never enter `sourcePlacementObstacles`, `shardHulls`, or the containment solver, because `ephemeral(element)` and `tangentWorldEphemeral` filters already exclude them. The resource pipeline browser test already proves that the body stays inside its Area under move, growth, and fold.

### Commit Blocks

`factForBlock` and `resolveVault` recognize `ref` matching `/^vault@[0-9a-f]{7,40}$/`:

- `kindId: "commit"`, `kindLabel: "Commit"`, `label`: the first 8 characters of the SHA, `targetClue: "vault"`, `stateText: []`, `states: []`, `sourceState: "current"`, `primaryAction: null`, `readAction: null`, `actionLabel: null`.
- The starter `commit` entry has `icon: "commit"` and no `click`.

Reason: a commit Block is placeable today and always renders as gone, which is wrong. A commit fact source and a commit reader do not exist. This design makes the commit recognisable and honest. Subject, date, and a reader are a follow-up Goal. This is departure 3.

## API

### Route

`GET /api/areas/map-kinds`

Response 200: `MapKindsCatalog` as JSON. The response is at most a few hundred kilobytes for the starter set: thirteen icons of about ten elements each.

Errors: none from the definition or icons. Those are `problems`. A filesystem error other than `ENOENT` on the folder is a 500 with `{ error }`, and the browser keeps its last catalog.

The route is read-only. It joins no POST allowlist in `server.mjs`.

Representative caller, in the JSX:

```js
useEffect(() => {
  let cancelled = false;
  requestResource("/api/areas/map-kinds").then((catalog) => {
    if (cancelled || catalog.revision === controller.snapshot().mapKinds?.revision) return;
    controller.setMapKinds(catalog);
  }, () => { /* The Map keeps its last catalog. */ });
  return () => { cancelled = true; };
}, [resourceCadence]);
```

The browser test fixture answers this path from `resourceApi` with a catalog object, the same way it answers `map-resources/resolve`.

### Catalog reader

```js
const catalog = createMapKindsCatalog({ root, repository, commit, starters, writable });
await catalog.read();   // MapKindsCatalog
```

`read()` reads `map-kinds.md` and lists `map-icons/`. It keeps a per-file memo keyed by path, `mtimeMs`, and `size`, so a 30 second cadence from several Map clients re-parses nothing that did not change. When the definition file is missing and `writable` is true, `read()` writes the starter definition. When the icon folder is missing or empty, it also writes the starter icons. It commits both with `add: map kinds starter`. It writes at most once per process, behind one shared promise. When `writable` is false, `read()` returns the starter from memory with `source: "starter"`.

`writable` is the same flag that gates other vault writes in the server. If no such flag exists for verify-app instances, the implementation adds one named `VAULT_WRITES_ENABLED`, defaulting to true, and `scripts/verify-app.mjs` sets it false.

### Resolver

`resolveMapEntity({ element, tangent, source, documents, resource, kinds })`. `kinds` is `MapKindsCatalog | null`. With `null`, the result is today's result plus `kindId` and `states`. With a catalog, the entry for `kindId` changes only `kindLabel`, `primaryAction`, `readAction`, and `actionLabel`:

| Verb | Action | Label |
|---|---|---|
| `copy-path` | `{ kind: "copy-path", resource, path }` | Copy path |
| `open` | `{ kind: "open-url", resource, url, targetLabel }` | Open PR, Open revision, or Open |
| `open-document` | `{ kind: "open-document", file, subpath, mode: "open" }` | Open Document |
| `open-goal` | `{ kind: "open-goal", file }` | Open Goal |
| `open-brain` | `{ kind: "open-area-brain", area }` | Open Brain |
| `details` | `{ kind: "details", resource }` | Details |

An entry without `click` keeps today's action. A `gone` resource keeps today's last-known action. Reason: the definition names the verb for a current thing, and the last-known action already says "last known" in its label.

`dispatchShellEntityAction` handles `details`: `openResources(entity.source.owner)`, then `setResourceDetails(action.resource)`. That code exists in the verbs bar today and moves into one function.

Every `resolveMapEntity` call in the JSX goes through one local helper, `resolveEntity(input)`, that adds `kinds: state.mapKinds`. Reason: the panel rows, Outline rows, discovery rows, and verbs bar must show the same verb label.

### Catalog record `kind`

`addAreaResource` and `editAreaResource` accept an optional `kind` string that must be a safe id. `validateAreaResourceCatalog` checks the shape when present and keeps the field. `projectAreaResourceCatalogs` copies it onto the entity. `resolveMapEntity` computes `kindId` as `entity.kind ?? entity.link?.kind (github-pr or phabricator-revision) ?? entity.target.kind`.

The Add dialog offers, in addition to Worktree, Repository, and Link, every catalog entry with `target: "url"` and a non-built-in id. Choosing one submits `target: { kind: "link", url }` and `kind: "<id>"`. The Resources panel row and the Block show the entry's label as the kind label.

### New kinds

A new entry with `target: "path"` parses and can carry icons and a click verb. It is not offered by Add in this release. Reason: a path target persists as `worktree` or `repository`, and both run Git checks that a plain folder fails. A plain folder target needs a fourth member of `TARGET_KINDS`, `folder`, that only stats the path. That change touches `normalizeAreaResourceTarget`, `observationTargetFingerprint`, `inspectLocalResource`, `currentResourcePresentation`, the Add editor, `inspect-target`, and discovery. It is contained but not demonstrated by any journey in the product design. This is departure 1. The definition parser accepts the entry so the file needs no edit when `folder` lands.

## Migration and compatibility

- **Scenes:** no format change. `customData.tangentWorldFigure` exists only in the projection. `tangentOf` and the validator accept unknown fields, so a scene from this build opens in the current main build unchanged.
- **Resource catalog:** `kind` is additive. `validateAreaResourceCatalog` already retains unknown fields, so the current main build reads a catalog with `kind` and ignores it. Rollback loses nothing.
- **Observation values:** `dirty` is additive. The Details panel and resolver treat an absent `dirty` as no state.
- **Two servers, one vault:** the main build on port 4321 and this branch on port 4323 read the same vault. A source shard written by this branch differs from one written by main only in caption words, and main rewrites those words on its first projection. `map-kinds.md` and `map-icons/` are unknown to main and inert. The `TREE_SKIP` change matters here: until main merges, main lists `map-icons` as an Area. Julian must not open that Area in main. The design accepts this for the merge window and names it under risks.
- **Definition versions:** the block tag carries `v1`. A later shape uses a new tag and the parser reads the newest, like the harness registry.
- **Starter files:** written once and never rewritten. A later starter icon is added to the folder only if the folder is empty, so Julian's edits are never overwritten.
- **Removal:** nothing temporary. `blockLabel` stays for cards for good.

## Operations

- **Dirty check cost:** one extra `git diff --quiet HEAD --` per local refresh. It reads the index and stats tracked files. On the Neara monorepo this is well under the 10 second deadline with a warm index. `--no-optional-locks` stops the check from writing the index and from contending with agents that run Git in the same checkout at the same time. Exit 1 means dirty. Exit 128 or another code stays an error, and the observation falls back to last-known as today. A bare checkout skips the check.
- **Untracked files:** excluded. `git status` scans the whole tree for untracked files and can take seconds on the monorepo, and a scratch file would keep a worktree dirty for good. This is departure 4, and an open question for Julian.
- **Catalog reads:** one `readdir` and up to fourteen small `readFile` calls per request, memoized by mtime and size. The route is not on any hot path.
- **Diagnosis:** the route returns `problems` with a scope and a name. The Map renders each as one line in the status island. A `console.error` on the server names a filesystem error. No new log file.
- **Partial results:** a broken icon file fails only the entries that name it. A broken entry fails only itself. A broken block fails every entry and every kind renders as a card. In every case the Map loads.
- **Starter write failure:** if the vault write or commit fails, `read()` serves the starter from memory with `source: "starter"`, adds one problem "Could not write the starter definition", and tries again on the next process start. The Map works either way.

## Notice surface

**Decision:** The problems render in a sibling of the save island, `div.tangent-map-kinds`. It has the same island style, `role="status"`, and `aria-live="polite"`. One line per problem: `Map kinds: <name>: <message>`. The element renders only when problems exist. It sits to the left of `.tangent-map-save`, in the same bottom row, so it does not cover the verbs bar or the Resources panel. On narrow layouts it stacks above the save island. Reason: the product design asks for the status area beside Saved, and the save island is the one status surface the Map has.

## Tests

Unit tests under `node:test`, no browser:

- `map-kinds.test.mjs`: parses the starter with zero problems and finds every icon it names in the starter set. Reports a JSON error with a line number. Reports an unknown verb, a verb not allowed for the target, an unknown state, a missing icon, a duplicate id, and a new id without a target, each as one problem on the right entry. Reads an `.excalidraw` file and an `.excalidrawlib` version 2 file with one item. Rejects a library with two items, an image element, and more than 1000 elements. Warns at more than 200. Normalizes bounds to the origin. Writes the starter once when the file is missing and never again. Serves the starter from memory when not writable.
- `area-map-figures.test.js`: first matching state wins, then the default, then card. Scaling keeps aspect ratio and scales points and font size, not stroke width. Ids and bindings remap per instance and a foreign binding becomes null. Every element is locked and ephemeral with the Block's `sourceId`. Opacity multiplies. The cache returns the same objects for the same key. `restoreFigurePresentation` returns body style, opacity, and caption geometry to the composed values and removes the marker.
- `area-board-core.test.js`: a figure's caption drops the kind word and keeps title, clue, state words, live dot, check mark, and `duplicate`. A card is unchanged. A figure gets no rail and a card still gets one. A gone figure has opacity 45 on body, text, and icons. `sceneOutline` gives the same label for a card and a figure. A Block whose entry has a problem is a card.
- `area-map-entities.test.js`: `states` for each facet, including `dirty`, `clean`, `bare`, `detached`, `last-known`, `success`, and `muted`. `kindId` precedence: record `kind`, then provider, then target. Verb to action mapping and the disallowed-verb card rule. `accessibleName` and `searchText` equal with and without a catalog. A commit ref resolves current with no action.
- `area-resource-observations.test.mjs`: with an injected `readGit`, exit 0 gives `dirty: false`, exit 1 gives `dirty: true`, exit 128 throws, a bare repository has no `dirty` field, and the call passes `--no-optional-locks`.
- `area-map-world-controller.test.mjs`: `setMapKinds` bumps `factsRevision` and notifies with `mapKinds` in the snapshot. Folding, scope, and Focus put icon ids in `hiddenIds` when their Block is hidden. The figure cache is cleared by `setMapKinds`.
- `map-kinds-routes.test.mjs`: the route returns the catalog and a 500 on a read error.
- `area-resource-catalog.test.mjs`: `kind` round-trips through add, edit, validate, and projection.

Browser tests, `TANGENT_BROWSER_TEST=1`:

- Extend the resource pipeline test in `area-map-world-browser.test.mjs`: the fixture answers `map-kinds` with the starter catalog. The rendered scene has locked `resource-figure-icon` elements for each worktree and the PR, and no rail. Fold hides them. Dragging a worktree figure to the Area edge keeps the body inside and moves the icons by the same delta. The source shard after the drag has no icon element, today's body style, and today's text geometry. Enter on the figure copies the exact path. The Outline row name equals the name asserted today.
- Extend `area-map-resources-browser.test.mjs`: a catalog with `"icon": "worktre"` renders cards and exactly one status line "Map kinds: worktree: icon `worktre` not found". A dirty worktree shows "Dirty" and the dirty icon. A missing worktree shows the missing icon. A merged PR shows the merged icon with the check mark. axe reports no serious violation.
- Evidence screenshots in `docs/design/map-resource-icons/`: one per starter kind beside a document card at 50 percent zoom, dark theme, plus dirty, missing, and merged. The implementation takes them on port 4323 with the chrome-devtools MCP, as the product step did.

Validation before commit: `npm run check`, `npm run test`, `npm run governance`, `npm run build`, and the pre-commit JSDoc lint on every new function.

## Rejected alternatives

- **Icon on the right, caption left-aligned in the container.** Simplest layout with no manual geometry. Rejected because the product design places the icon on the left, and the region label precedent makes the manual layout safe.
- **Rebind the caption to a projection-only caption box.** Rejected. Excalidraw re-lays bound text against its container on resize and text change, and a container that does not move with the Block snaps the caption back.
- **A free text caption grouped with the body.** Rejected. Group selection breaks the one-selected-Block invariant and a free text lags the body during a drag.
- **Persist the quiet body like ghost styling.** Rejected. Ghost is a fact about the entity. The body style is presentation of a definition that can change any time, and a persisted quiet style leaks into the main build through the shared vault.
- **Parse icon files in the browser.** Rejected. The server already owns every file read and the scene validator, and one parser means one problem list.
- **A new `target.kind` per definition kind.** Rejected. The closed union is the identity, fingerprint, and observation key of every resource. An additive `kind` field on the record changes nothing that exists.
- **`git status --porcelain` for dirty.** Rejected for cost on the monorepo and the untracked scan. Kept as the way to add untracked files later if Julian wants them.
- **Embed the catalog in the world snapshot.** Rejected. The world snapshot is revision-fenced authority. The catalog is a fact feed like resolutions and follows the resolution cadence.
- **`~/.tangent/trees/.map-icons/`.** A dot folder needs no `TREE_SKIP` change. Rejected because Obsidian and Finder hide it and Julian edits these files by hand.

## Assumptions, unknowns, and risks

### Assumptions

- Excalidraw 0.18.1 renders a bound text at its own stored geometry without re-layout on `updateScene`. **Observed** for region labels in the live product. **Assumption** that the same holds with `verticalAlign: "middle"`. The browser test checks it.
- Excalidraw's shape and canvas caches are keyed by element object identity, so the figure cache removes per-frame regeneration. **Assumption** from reading 0.18 behaviour, not from a benchmark. The drag test records `area_map_gesture_solved` timings, which stay the proof.
- `git diff --quiet HEAD --` on the Neara monorepo finishes well inside 10 seconds with a warm index. **Assumption**. The first refresh after a reboot can be slower and falls back to last-known, which is acceptable.

### Unknowns

- Whether Julian wants untracked files to count as dirty. The design excludes them and says why.
- Whether Julian wants a placeable `path` kind now. The design defers `folder` and lists its touch points.
- Whether a commit needs a reader in this Goal. The design defers it.

### Risks

- Until this branch merges, the main build lists `map-icons` as an Area. Opening it in main would write a note template into the icon folder. Mitigation: merge soon, and the README reserves the name.
- A large hand-drawn library item can have hundreds of freedraw points per element. The element cap does not bound points. Mitigation: the figure cache, and the 200 element warning tells Julian which icon is heavy.
- The caption wraps at 18 columns, so a long label takes three lines and a long state word list can be clipped by the 108 pixel caption height. Mitigation: the caption keeps the label first, and the Outline and accessible name hold the full words.

### Departures from the product design

1. A new `path` kind is not placeable in this release. The definition accepts it.
2. An icon with more than 1000 elements is a problem, not a warning.
3. The starter `commit` entry has no `click`, and a commit resolves with the short SHA and no subject.
4. `dirty` excludes untracked files.

### Reconsider this design if

- Julian wants untracked files counted. Then replace the diff call with `git status --porcelain --untracked-files=normal -z` and accept the scan cost, or add a second observation with a longer cadence.
- Drag frame timings rise on a Map with many figures. Then render icons through one `freedraw`-free composite per icon, or lower the element cap.
- A second definition scope appears, per Area. Then add an Area-level block with the same tag and merge by id, like the Area harness contract.

## Evidence index

- Block factory, labels, rail, and fingerprint: `packages/agent-shell/app/public/area-board-core.js`, lines 139 to 281 and 406 to 418.
- Projection and hiding: `packages/agent-shell/app/public/area-map-world-controller.js`, lines 257 to 329 and 839 to 858.
- Publish, ephemeral filters, and hit tests: `packages/agent-shell/app/browser/area-map-world.jsx`, lines 72, 251 to 259, 518 to 567, 777 to 792, 1764 to 1779, 1927, 2068 to 2160, and 2960.
- Source split: `packages/agent-shell/app/public/area-map-world-core.js`, lines 137 to 194 and 490 to 557.
- Resolver and actions: `packages/agent-shell/app/public/area-map-entities.js`.
- Local observation: `packages/agent-shell/app/area-resource-observations.mjs`, lines 54 to 94.
- Git helper: `packages/repo/src/git.ts`, lines 18 to 36.
- Catalog target union: `packages/agent-shell/app/area-resource-catalog.mjs`, lines 11 to 15 and 153 to 202.
- Harness registry reader and starter write: `packages/agent-shell/app/launch-catalog.mjs`, lines 9 to 21 and 229 to 232; `packages/agent-shell/app/launch-environment.mjs`, lines 10 to 77.
- Area discovery: `packages/agent-shell/app/server.mjs`, lines 888 to 913.
- Scene validator: `packages/agent-shell/app/area-canvas.mjs`, lines 9 to 91.
- Picker commit choice: `packages/agent-shell/app/public/area-board-picker.js`, line 16.
- Browser test harness and the resource pipeline test: `packages/agent-shell/app/area-map-world-browser.test.mjs`, line 1334; `packages/agent-shell/app/area-map-resources-browser.test.mjs`, lines 1 to 175.
- Excalidraw version: `packages/agent-shell/package.json`, `@excalidraw/excalidraw ^0.18.1`, installed 0.18.1.
- Vault rules: `~/.tangent/trees/README.md`.
