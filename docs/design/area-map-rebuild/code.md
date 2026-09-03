# Rebuild the Map on principles: code design

Code design for [[goal-rebuild-the-map-on-principles]]. The implementation follows this document and is run as a multi-agent workflow whose phases are listed at the end.

Brief: `~/.tangent/trees/otto/tangent/records/brief-map-rebuild.md`. Audit: `~/.tangent/trees/otto/tangent/map-usability-audit.md`. Precedent records: `docs/design/map-resource-icons/code.md`, `docs/design/map-entities/design-record.md`, ADR-0051, ADR-0052.

Julian's added direction, 2026-09-03: apply the otto-dnd engineering bar to the Map. That bar bans the raw `number` type in favour of unit and semantic brands, caps function size, and runs duplicate detection with jscpd. He asked for those plus whatever other lints mechanically stop agents duplicating code, dumping HTML, JS and CSS inline, and using raw numbers. This design adopts that bar for the Map and names every lint.

He also said a ground-up rebuild is easier than maintaining the old code. So the browser Map is written fresh, module by module, from the contract in this document and the browser suites. A worker reads the old component to learn a behaviour, never to copy a block of it. The kernel is the one part the audit proved sound, so it is kept behind a typed boundary rather than rewritten; converting it is a follow-up Goal.

## Decision summary

- **Decision:** The browser Map is rewritten in TypeScript under `packages/agent-shell/app/map/`. Logic is `.ts` and is unit tested under Node 26, which runs TypeScript directly. Render code is `.tsx` and stays thin. The one esbuild entry point keeps its output name, so the server and the host page do not change.
- **Decision:** The framework-neutral kernel is kept as it is: the controller, world core, board core, entities, figures and the server modules. They are tested, they carry ADR-0051 and ADR-0052, and the audit refuted eight findings because they already handle the case. The new code reaches them only through one typed boundary module that brands every value on the way in.
- **Decision:** Every numeric value in the Map carries a unit or a semantic brand. `ScreenPx`, `ScenePx`, `SourcePx`, `Zoom`, `Milliseconds`, `Count`, `Index` and `Ratio` live in one owner directory. Points, rectangles and deltas are branded by frame. The raw `number` keyword is banned outside that directory by lint.
- **Decision:** One pure function answers what a pointer press means. It returns one value from a closed union. Excalidraw is told what it may hold selected before its first move frame, from that answer, in one module. No other module writes Excalidraw's selection from input.
- **Decision:** Every Map surface is declared once in a registry with its layer, modality, Escape behaviour and focus behaviour. One kit component renders registered surfaces. Escape pops the top of the stack and nothing else. Only the kit renders a dialog, a backdrop or a focus call.
- **Decision:** Every layout number is named once in `layout-tokens.ts`. The Map root emits them as CSS custom properties. Colours and type live in `tokens.css`, the z-index scale in `layers.css`. Feature code cannot write CSS, cannot position, and cannot hold an unnamed number.
- **Decision:** Every value the server mints and later guards is registered as a pair, minter beside guard, in one shared module. One property test proves every registered pair. Routes import guards from the registry only.
- **Decision:** A lint kit under `scripts/lint/` enforces all of the above on staged files at commit time and on the whole tree in `npm run lint`. Each lint is a Node script over the TypeScript AST with a `GRANDFATHERED_FILES` ratchet that burns down to empty. jscpd blocks duplicate code in the Map scope.
- **Decision:** `area-map-world.jsx` is deleted, not split. Its 3,273 lines are replaced by modules of at most 400 lines and functions of at most 80. The browser test suites and their selectors are the contract the new tree must satisfy unchanged.
- **Decision:** Nothing in the vault changes. No shard format, no `map-kinds.md` shape, no catalog field. Julian's real Area geometry is loaded against a copy of his vault as the final proof.

Open decisions for Julian are under "Assumptions, unknowns, and risks".

## Technical contract

Observable success, in code terms:

- No file under `packages/agent-shell/app/map/` exceeds 400 lines and no function exceeds 80 lines. The lint kit fails otherwise.
- `meaningOfPress` is the only function that decides what a press does. A property test proves it is total, deterministic, and never names an Area that fold, scope or Find has hidden.
- `area-map-wire-values.property.test.js` proves every minter in the registry produces values its own guard accepts, and the server rejects nothing it minted.
- `layout-tokens.ts` is the only file with layout numbers. Every right-anchored or centred surface subtracts the panel inset because the kit does it, not because a rule remembered to.
- The existing browser suites pass unchanged: `area-map-world-browser`, `area-map-resources-browser`, `area-map-resources-nested-browser`, `area-map-resources-server-browser`, `area-map-figure-images-browser`, `area-map-rollout-browser`, `area-map-ui`, `map-first-main-surface`.
- Every defect this design says it removes by construction has a regression test that fails against `45a68759`.
- A copy of Julian's vault boots, every Area map loads, and the region count equals the Area count.

Non-goals: converting the kernel or the server to TypeScript, upgrading Excalidraw, changing the product rules in `map-kinds.md`, changing wire formats, and fixing wording defects beyond giving them one owner.

## Current system

Every claim in this section is **Observed** at `45a68759` on branch `map-rebuild`.

### One component

`packages/agent-shell/app/browser/area-map-world.jsx` is 3,273 lines. `AreaMapWorld` starts at line 419 and holds 36 `useState` calls and 60 `useRef` calls. It owns the controller subscription, the Excalidraw callbacks, the pointer gesture, the projection fence, the keyboard listener, the Resources panel with its drafts, discovery, details, editor, undo, three recovery dialogs and placement, the Outline, the Block picker, Find, Help, the save status, the kinds notice, announcements and the debug table. The render section runs from line 2826 to 3271.

The entry `area-board-excalidraw.jsx` mounts it inside an error boundary and exposes a bridge object with sixteen functions to `public/area-board.js`. That bridge is the host contract and is kept.

### Two pointer owners

`beginPointerGesture` at line 2082 decides the meaning of a press after Excalidraw has already received it. It computes `spatialAuthoredHit`, `deepest`, `hitBlock`, `hitRegion` and `rejectedAreaTransform`, then writes `selectedElementIds` back into Excalidraw through `projectCanvas` in four places to correct what Excalidraw would otherwise drag. The fix in `45a68759` added the fourth write. The meaning of a press is spread across that function, `handleCanvasPointerDown`, `handleCanvasPaste`, `placementPoint`, and the keyboard listener's Space handling, and each computes its own hit.

### Guards without minters

`area-map-world-index.mjs` line 18 defines `OPAQUE_ID`. The fix in `78ecd9b6` made `digest` at line 31 prefix `r` so it satisfies the guard. The two now agree by comment, not by test. `isSafeResourceId` in `public/area-map-entities.js` guards resource ids the server mints elsewhere. Nothing enumerates the pairs.

### Copied constants

`browser/area-board-excalidraw.css` now names `--tangent-map-panel-width` and `--tangent-map-panel-inset` once, after `78280179`. The JSX still holds bare `16`, `10`, `1`, `960`, `1_000`, `30` and `10` for nudge distances, the narrow breakpoint, the paste window and list windows. `AREA_MAP_LAYOUT` in `public/area-map-world-core.js` holds the kernel's numbers. Every `position: absolute` and every `z-index` is retyped per rule: 4, 17, 18, 19, 20, 30, 45, 50, 55, 60, 70.

### What already exists and is kept

- `public/area-map-world-controller.js`, 1,147 lines. Selection, history, loading, conflicts, drafts, camera and projection. ADR-0051.
- `public/area-map-world-core.js`, 873 lines. Composition, the layout kernel, the containment solver, placement. ADR-0052. Property tested by `area-map-containment.property.test.js`.
- `public/area-board-core.js`, `area-map-entities.js`, `area-map-figures.js`, `area-map-find-core.js`, `area-board-picker.js`, `keyboard-context.js`, and the server modules.
- The browser test harness in `area-map-world-browser.test.mjs` and its siblings, roughly 6,800 lines, driving the Map by role, accessible name and `tangent-map-*` class.
- `scripts/lint-function-docstrings.mjs`, the pre-commit hook, and the governance package.
- Node 26 with native TypeScript execution, esbuild, Playwright and the TypeScript compiler package, all already installed.

## Structure

```
packages/agent-shell/app/map/
  index.tsx                 the esbuild entry: mountAreaBoardEditor, the error boundary, the bridge
  AGENTS.md                 the module guide (every directory below carries one)
  units/                    the brand owners; the only files allowed to say `number`
    brand.ts                Brand<T, Name>
    units.ts                ScreenPx, ScenePx, SourcePx, Zoom, Milliseconds, Count, Index, Ratio
    frames.ts               Point<F>, Rect<F>, Delta<F>, Size<F> for F in screen | scene | source
    ids.ts                  AreaKey, RuntimeId, SourceId, ShardOwner, WorldRevision, ResourceId
    scalar-math.ts          brand-preserving add, subtract, scale, clamp, midpoint, contains, hits
  kernel/
    kernel-boundary.ts      the only importer of ../public/*.js; brands every value on the way in
    kernel-types.ts         the typed shapes of controller snapshot, composition, world, scene
  layout/
    layout-tokens.ts        every layout number, named once; emits CSS custom properties
    layout-tokens.test.ts   the CSS the Map root emits matches the table
  input/
    hit-test.ts             one hit test over the projected visible scene
    press-meaning.ts        meaningOfPress(context): PressMeaning, pure
    pointer-session.ts      begin, preview, settle, end; owns what were 20 pointer refs
    excalidraw-subordination.ts  the only writer of selectedElementIds from input
    keyboard-dispatch.ts    the one host keydown listener; surface stack first, canvas keys second
    placement-point.ts      where B, paste and Place land, always inside the viewport
    nudge.ts                arrow-key moves through the same session as a pointer move
  canvas/
    MapCanvas.tsx           the Excalidraw element and its props; forwards to the session
    projection.ts           projectCanvas, the expected-projection fence, deferred updates
    text-edit.ts            buffered text edits and stale editing state
    icon-files.ts           figure icon registration
    AreaLabels.tsx          name pills; pointer-events none, keyboard reachable
  surfaces/
    surface-registry.ts     every surface: id, layer, modality, escape, focusOnOpen, restoreFocus
    surface-stack.ts        pure reducer: open, close, backStep, escape pops the top
    announce/               announce-store.ts with a TTL, LiveRegion.tsx
    save/                   SaveStatus.tsx, RecoveryDialog.tsx
    outline/                outline-model.ts, Outline.tsx
    picker/                 picker-store.ts, Picker.tsx
    find/                   find-store.ts, Find.tsx
    help/                   Help.tsx
    placement/              placement-store.ts, PlacementBar.tsx
    resources/              resources-store.ts, resources-effects.ts, resources-mutations.ts,
                            ResourcesPanel.tsx, ResourceRow.tsx, ResourceDetails.tsx,
                            ResourceEditor.tsx, ResourceRecovery.tsx, Discovery.tsx
  ui/                       the Map's kit; the only owner of CSS, position, z-index, focus, dialogs
    tokens.css              colours, type, shadows
    layers.css              the z-index scale, one name per layer
    map.css                 every other rule, composed from tokens
    Surface.tsx             renders a registered surface: backdrop, role, focus on open, restore
    Button.tsx, TextField.tsx, Listbox.tsx, Dialog.tsx, Panel.tsx, Sheet.tsx, Toolbar.tsx
  copy.ts                   every user-visible sentence; failure kinds map to words here
  legacy/
    LegacyAreaCanvas.tsx    the format-2 rollback editor, moved unchanged in behaviour
  MapRoot.tsx               composes controller state, MapCanvas, the surface stack; under 200 lines
```

Public modules stay at `packages/agent-shell/app/public/`. One file is added there because the server and the browser both import it: `area-map-wire-values.js`.

### Units and frames

`units/` follows `~/Projects/otto-dnd/src/base/units/units.ts`. A brand is `T & { readonly __brand: Name }`. At runtime a `ScenePx` is a number. Arithmetic drops the brand, so `scalar-math.ts` re-brands each result, the way the containment solver re-brands its rectangles.

The three frames match the kernel's three coordinate spaces. `screen` is CSS pixels from the pointer event. `scene` is Excalidraw's world after composition. `source` is shard-local, what the vault stores. `eventScenePoint` becomes `toScene(screenPoint, camera)` in `scalar-math.ts` and is the only place the conversion is written.

`Zoom` is a `Ratio`. `Milliseconds` is for the paste window, the pointer settle and the resource cadence. `Count` and `Index` are for list windows and find positions. The `T[number]` indexed access is not a quantity and is allowed.

### The kernel boundary

`kernel/kernel-boundary.ts` imports `../public/area-map-world-controller.js`, `area-map-world-core.js`, `area-board-core.js`, `area-map-entities.js`, `area-map-figures.js`, `area-map-find-core.js`, `area-board-picker.js` and `keyboard-context.js`, and exports them with typed signatures from `kernel-types.ts`. Every rectangle that leaves the boundary is a `Rect<'scene'>` or `Rect<'source'>`. Every id is branded. The kernel is not edited for this. A lint confines `../public/` imports to this directory.

### Pointer authority

`input/press-meaning.ts` exports one pure function.

```ts
type PressMeaning =
  | { kind: "pan" }
  | { kind: "place-resource"; point: Point<"scene"> }
  | { kind: "text"; point: Point<"scene"> }
  | { kind: "rubber-band" }
  | { kind: "grab-element"; id: RuntimeId }
  | { kind: "add-to-selection"; id: RuntimeId }
  | { kind: "move-area"; area: AreaKey }
  | { kind: "resize-area"; area: AreaKey; handle: ResizeHandle }
  | { kind: "ignore"; reason: "rotation" | "hidden" | "editing-text" };
```

Its context is what the press can see: the scene point, the modifiers, whether Space is held, the active tool, the stable selection, the pointer command Excalidraw reported (move, resize, ignore), and the result of `hit-test.ts` over the projected visible scene. The rules are written in one ordered list, and the order is the product rule:

1. Space held, or the hand tool: `pan`.
2. A placement is open: `place-resource`.
3. The text tool: `text`.
4. Text is being edited: `ignore`.
5. Shift or Cmd with an authored element under the point: `add-to-selection`.
6. The selected Area's resize handle: `resize-area`. A rotation handle: `ignore rotation`.
7. An authored element under the point, inside its body: `grab-element`.
8. The deepest visible Area under the point, if it is selected and the press is inside its body: `move-area`. If it is not selected: `move-area` with a selection change. Shift with no element under the point: `rubber-band`.
9. Nothing under the point: `rubber-band`.

`hit-test.ts` is the one place that decides what is under a point. It takes the projected scene, the hidden set from fold, scope and Find, and the zoom, and returns the topmost visible authored element and the deepest visible Area. Hidden and ephemeral elements are never hits. The grab padding is a layout token and applies to authored elements only.

`excalidraw-subordination.ts` turns a `PressMeaning` into the selection Excalidraw must hold before its first move frame, and applies it through `projection.ts` with `captureUpdate: "NEVER"`. For `move-area` it selects that region alone. For `grab-element` it selects that element. For `rubber-band` and `pan` it clears the selection. For `resize-area` it keeps the region. This is the only module that writes `selectedElementIds` from an input event, and a lint confines that write to it.

`pointer-session.ts` is a class with named fields replacing the twenty pointer refs. `begin(meaning, context)` opens the controller gesture. `preview(point)` solves through the kernel for `move-area` and `resize-area` only. `settle()` and `end()` publish through `projection.ts` and close the gesture. `nudge.ts` runs an arrow-key move through the same session so a keyboard move and a pointer move share one path.

`placement-point.ts` answers where B, paste and Place land. Its input is the camera, the viewport size and the last pointer point if it is inside the viewport. Its output is always inside the viewport, and the target Area is the deepest visible Area at that point from `hit-test.ts`. A property test proves both.

### Keyboard

`input/keyboard-dispatch.ts` installs the one `keydown` listener on the host. It asks the surface stack first: if a surface is open, the surface's declared key handling runs and the canvas sees nothing unless the surface is a non-modal panel and the event target is outside it. Then it runs the canvas keys: Find, the picker, Outline, Help, Escape, arrows, Space, and Excalidraw's own tool keys. Space is a session flag read by `meaningOfPress`, so Space-drag is `pan` before any selection logic runs.

Element-level `onKeyDown` exists only in `ui/`, for the roving tabindex of `Listbox.tsx` and the text fields. Feature components do not handle keys.

### Surfaces

`surfaces/surface-registry.ts` declares every surface once.

```ts
const SURFACES = {
  resources:        { layer: "panel",     modality: "panel",     escape: "close",     focusOnOpen: "heading", restoreFocus: true },
  resourceDetails:  { layer: "panel",     modality: "panel",     escape: "back-step", focusOnOpen: "heading", restoreFocus: true },
  resourceEditor:   { layer: "panel",     modality: "panel",     escape: "back-step", focusOnOpen: "first-control", restoreFocus: true },
  resourceRecovery: { layer: "dialog",    modality: "modal",     escape: "close",     focusOnOpen: "first-control", restoreFocus: true },
  sceneRecovery:    { layer: "dialog",    modality: "modal",     escape: "close",     focusOnOpen: "first-control", restoreFocus: true },
  placement:        { layer: "transient", modality: "transient", escape: "close",     focusOnOpen: "none",    restoreFocus: false },
  picker:           { layer: "dialog",    modality: "modal",     escape: "close",     focusOnOpen: "first-control", restoreFocus: true },
  find:             { layer: "hang",      modality: "panel",     escape: "close",     focusOnOpen: "first-control", restoreFocus: true },
  outline:          { layer: "hang",      modality: "panel",     escape: "close",     focusOnOpen: "first-control", restoreFocus: true },
  help:             { layer: "dialog",    modality: "modal",     escape: "close",     focusOnOpen: "heading", restoreFocus: true },
  transaction:      { layer: "toast",     modality: "transient", escape: "none",      focusOnOpen: "none",    restoreFocus: false },
} as const;
```

The layer names are the names in `ui/layers.css`. `surface-stack.ts` is a pure reducer over an ordered list of open surface ids. `escape(stack)` pops the top and returns which surface closed, or `back` when the stack is empty. `back-step` pops the top and leaves its parent open, which is how Details returns to the panel instead of closing it. A modal surface on the stack makes the canvas inert through one backdrop that `Surface.tsx` renders. A test asserts no two modal surfaces share a layer and every surface in the registry has a component.

`ui/Surface.tsx` is the only component that renders `role="dialog"`, `aria-modal`, a backdrop, or calls `.focus()`. It reads the registry, moves focus on open to the declared target, and restores focus to the opener on close. Feature surfaces render inside it and receive `close` and `backStep` as props.

### State

The controller snapshot stays the world state. Each surface directory has a `*-store.ts` that is a pure reducer over a typed state and a closed action union, tested under Node. Effects that fetch or mutate live in `*-effects.ts` and dispatch actions. `MapRoot.tsx` holds one `useReducer` per store and passes state and dispatch down. `resources-store.ts` replaces twenty-one `useState` calls and eighteen refs. The reducer-purity lint bans fetch, timers, `Date.now`, `Math.random` and mutating array methods in every `*-store.ts`.

### Layout tokens

`layout/layout-tokens.ts` is the one owner of every layout number.

```ts
export const LAYOUT = {
  panelWidth: "min(680px, 72%)",
  rowTop: screenPx(16), rowTopUnderPanel: screenPx(76),
  hangTop: screenPx(62), hangTopUnderPanel: screenPx(122),
  edgeInset: screenPx(12), controlInset: screenPx(24), saveInset: screenPx(62),
  grabPadding: screenPx(10),
  nudge: scenePx(1), nudgeFast: scenePx(10),
  placementStep: scenePx(16), placementStepFine: scenePx(1),
  narrowBreakpoint: screenPx(960),
  pasteWindow: milliseconds(1_000),
  pickerWindow: count(30), findWindow: count(4),
  resourceCadence: milliseconds(30_000),
} as const;
```

`layoutCssVariables(LAYOUT)` returns the `--tangent-map-*` custom properties and `MapRoot.tsx` sets them on the root element. That is the one inline style the lint allows. `ui/map.css` reads them. The old CSS file is deleted and its rules move into `ui/map.css` with every raw colour replaced by a token. A test renders `layoutCssVariables` and asserts every `var(--tangent-map-*)` used in `map.css` is emitted.

### Wire values

`public/area-map-wire-values.js` registers each minted value beside its guard.

```js
export const WIRE_VALUES = {
  worldRevision: { mint: (value) => `r${sha256(value).slice(0, 16)}`, accepts: (value) => OPAQUE_ID.test(value) },
  resourceId:    { mint: () => ..., accepts: isSafeResourceId },
  runtimeId:     { mint: runtimeId, accepts: ... },
  regionId:      { mint: regionId, accepts: ... },
  operationId:   { mint: () => crypto.randomUUID(), accepts: ... },
};
```

`area-map-wire-values.property.test.js` walks every entry with a seeded generator, mints ten thousand values, and asserts each is accepted. It also asserts each guard rejects an empty string, a leading `-`, a leading `_`, and a value over the length cap. `OPAQUE_ID` and `digest` move here from `area-map-world-index.mjs`, which imports them. `isSafeResourceId` moves here and `area-map-entities.js` re-exports it. A lint bans an id-shaped regex literal outside this file, so a new guard cannot appear without its minter.

### Copy

`copy.ts` holds every sentence a person reads. `copyForFailure(kind)` maps a failure kind to a headline and a next step, with a default that names the operation and never prints the kind. Dialog buttons take a `label` from `copy.ts` and an `action`; the Dialog kit has no button without an action. `announce-store.ts` gives every announcement a `Milliseconds` TTL from `LAYOUT`, and a property test proves the store is empty after the longest TTL passes.

## The lint kit

All lints live in `scripts/lint/` beside the docstring lint and follow its shape: a Node script, the TypeScript AST where a token match is not enough, `--staged` for the pre-commit hook, and a `GRANDFATHERED_FILES` ratchet. `scripts/lint/run-pool.mjs` runs them as a bounded pool, `npm run lint` runs the pool, and `.githooks/pre-commit` runs the pool with `--staged`. Every lint has a `.test.mjs` with a passing fixture and a failing fixture. The docstring lint joins the pool unchanged.

The strict scope is `packages/agent-shell/app/map/**` and `scripts/lint/**`, with no grandfathering. The wider scope is `packages/agent-shell/app/**` and `packages/agent-shell/app/public/**`, where files that fail at introduction are listed in the ratchet.

| Lint | Rule | Owner or exception |
|---|---|---|
| `function-size` | No function over 80 lines | none |
| `module-size` | No production module over 400 lines | none |
| `no-raw-number` | The `number` keyword appears only in the unit owners | `app/map/units/*.ts` |
| `no-unnamed-number` | A numeric literal other than 0, 1 and -1 appears only in the owners | `app/map/units/`, `app/map/layout/layout-tokens.ts`, `public/area-map-world-core.js` |
| `no-any` | No `: any`, `as any`, `<any>`, `Record<string, any>` | none |
| `no-long-param-list` | No function takes more than 7 parameters | none |
| `no-junk-drawer-modules` | No file named utils, helpers, common or misc | none |
| `require-module-agents` | A directory with 5 or more production files carries `AGENTS.md` | none |
| `ui-style-confinement` | No `.css` file, `<style>`, `style=`, `.style.` or `setProperty("--")` outside the kit | `app/map/ui/`, and `MapRoot.tsx` for the token emit |
| `design-token-confinement` | No raw hex, rgb, hsl, font-size or font-family outside tokens | `app/map/ui/tokens.css` |
| `layer-confinement` | `z-index` is defined only in the layer scale and used only as `var(--tangent-layer-*)` | `app/map/ui/layers.css` |
| `no-freestanding-position` | `position: absolute` and `position: fixed` only in the kit | `app/map/ui/` |
| `no-imperative-dom` | No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `document.createElement`, `appendChild` | none |
| `no-raw-interactive-elements` | No `<button>`, `<input>`, `<select>`, `<textarea>` outside the kit | `app/map/ui/` |
| `surface-confinement` | `role="dialog"`, `aria-modal`, `autoFocus` and `.focus(` only in the kit | `app/map/ui/` |
| `keyboard-confinement` | `keydown` and `keyup` listeners on host, document or window only in the dispatcher; element `onKeyDown` only in the kit | `app/map/input/keyboard-dispatch.ts`, `app/map/ui/` |
| `pointer-confinement` | Excalidraw's `onPointerDown`, `onPointerUp`, `onPointerUpdate` only in `MapCanvas.tsx`; `pointerdown`, `pointermove`, `pointerup` listeners nowhere else | `app/map/canvas/MapCanvas.tsx` |
| `selection-write-confinement` | `selectedElementIds` is written only in the subordination module and the projection | `app/map/input/excalidraw-subordination.ts`, `app/map/canvas/projection.ts` |
| `kernel-boundary-confinement` | `../public/` is imported only in the kernel boundary | `app/map/kernel/` |
| `reducer-purity` | No fetch, timers, `Date.now`, `Math.random`, or mutating array methods in a `*-store.ts` | none |
| `copy-confinement` | No JSX text node with two or more words outside `copy.ts` | `app/map/copy.ts`, `app/map/ui/` |
| `wire-guard-confinement` | No id-shaped regex literal outside the wire registry | `public/area-map-wire-values.js` |
| `function-docstrings` | Existing, unchanged | existing |
| jscpd | Blocking on the strict scope at 45 tokens; report only elsewhere | `.jscpd.json` |

jscpd is added as a dev dependency. `npm run lint:dup` runs it in report mode over the app, and the pool runs it in blocking mode over the strict scope.

The lints are the mechanism. Their tests are the proof the mechanism works. An agent writing Map code that duplicates a helper, retypes a number, inlines a style, adds a keydown listener or renders a dialog itself cannot commit.

## Tests

- Unit tests under Node for every `.ts` module in `input/`, `surfaces/*/…-store.ts`, `layout/`, `units/`, and `kernel/`, as `*.test.ts` beside the module.
- Property tests: `press-meaning.property.test.ts` (total, deterministic, never a hidden Area, Space always pans, a Block press never moves an ancestor), `placement-point.property.test.ts` (always inside the viewport, always a visible Area), `announce-store.property.test.ts` (always clears), `surface-stack.property.test.ts` (escape pops exactly one, back-step leaves the parent), and `area-map-wire-values.property.test.js`.
- The existing browser suites, unchanged. Their selectors are the contract.
- One regression browser test per defect removed by construction, each named for the defect in the audit, each proved to fail against `45a68759` by running it once against the old bundle before the old component is deleted.
- Real geometry: a Playwright run against a copy of Julian's vault under a throwaway `HOME` and `TREES_ROOT`, loading every Area map, asserting the region count and saving a screenshot beside this document as evidence.

## What is kept, restructured and deleted

Kept unchanged: the kernel modules under `public/`, the server modules, the vault formats, `map-kinds.md`, the host contract in `public/area-board.js`, the bridge's sixteen functions, the browser suites and their selectors, the docstring lint, the governance package, Excalidraw 0.18.1.

Restructured: the browser Map into the tree above. `LegacyAreaCanvas` moves to `legacy/` with its behaviour unchanged. `OPAQUE_ID`, `digest` and `isSafeResourceId` move into the wire registry with re-exports from their old homes. `area-board-excalidraw.css` moves into `ui/` with tokens. The esbuild entry path changes to `app/map/index.tsx`; its output name does not.

Deleted: `browser/area-map-world.jsx`, `browser/area-board-excalidraw.jsx`, `browser/area-board-excalidraw.css`, and the `browser/` directory.

## The eleven open defects

Removed by construction, each with a regression test:

1. **Place on Map, the placement preview, and Fit and centre land behind the Resources panel.** Only the kit positions, and the kit subtracts the panel inset from `LAYOUT` for every right-anchored and centred surface.
2. **Space-drag folds and drags the selected Area.** Rule 1 of `meaningOfPress` returns `pan` before selection is considered.
3. **A Block placed while an Area is folded lands in a hidden Area.** `placement-point.ts` targets the deepest visible Area from the one hit test, and the property test forbids a hidden target.
4. **Hidden Blocks still block Area drags.** `hit-test.ts` runs over the projected visible scene only.
5. **Wheel and pointer stop over an Area name label.** `AreaLabels.tsx` renders pills with `pointer-events: none` from the kit and keeps them keyboard reachable.
6. **Escape closes the whole Resources sheet and strands the Add-back dialog.** `surface-stack.escape` pops the top only; Details and the editor declare `back-step`.
7. **Only the first picker result is reachable; the Outline opens without focus.** `Listbox.tsx` has a roving tabindex, and `Surface.tsx` moves focus to the declared target on open.
8. **The map toast never clears.** `announce-store.ts` has a TTL and a property test.
9. **B and paste place into an off-screen Area after panning.** `placement-point.ts` derives from the camera and the property test keeps it inside the viewport.

Needs its own fix inside the new structure:

10. **Restore or Discard names no cause; every button after a save failure is a dead end.** The Dialog kit requires a cause and an action per button, and `copyForFailure` never prints a code. The words for each failure kind are a wording task in `copy.ts`.
11. **Several messages print internal failure codes as their headline.** Same owner, same wording task.

Needs a product decision from Julian:

- **A rubber-band selection started inside an Area moves the Area.** Rule 8 makes a press inside an unselected Area's body a move, and Shift-press a rubber band. If Julian wants a plain press inside an Area to rubber-band its Blocks, that is one line in `press-meaning.ts` and its property test.

## Assumptions, unknowns, and risks

- **Assumption:** Node 26 runs `.ts` tests natively with type stripping. Verified on this machine. Type-only constructs are used; no enums, namespaces or parameter properties.
- **Assumption:** The kernel is not converted to TypeScript. The raw-number lint therefore covers the new Map and not the kernel. Converting the kernel is a separate Goal.
- **Unknown:** Excalidraw 0.18.1 exposes no appState key for the picker's stroke swatches. The dark-theme swatch defect stays open until an upgrade, which this design does not propose.
- **Risk:** The browser suites query `tangent-map-*` classes and accessible names. Every class name, role and name they use is kept. A selector inventory is checked into the workflow's first phase so no agent renames one.
- **Risk:** Concurrent esbuild runs share `dist/browser`. Only the integration phase builds and runs browser suites, and it runs one agent at a time.
- **Product decision:** rubber band inside an Area, above.

## How it is built

The rebuild runs as a workflow in phases. Agents in one phase own disjoint files and commit only those files on `map-rebuild`. No phase touches `area-map-world.jsx` until the integration phase deletes it.

1. **Lint kit and foundations.** One agent per lint, each with its tests. In parallel: `units/`, `layout/`, `kernel/`, the wire registry with its property test, the surface registry and stack, the kit under `ui/`, and `copy.ts`. Barrier, then the pool runs green on the strict scope.
2. **Build fresh.** One agent per module group: hit test and press meaning; pointer session, subordination and nudge; keyboard dispatch and placement point; canvas host and projection; each surface directory; `MapRoot.tsx` and `index.tsx`. Each agent writes the module from this design and the behaviour the browser suites require, writes its tests, and typechecks. The old component is reference for behaviour only. None builds the bundle.
3. **Integrate.** One agent at a time: point esbuild at the new entry, build, run every browser suite, fix, repeat until green, then delete the old files. A failing suite fans out one fixer per failing test, then re-integrates.
4. **Prove.** One agent per defect writes the regression test, proves it fails against the old bundle and passes against the new one. An independent verifier tries to refute each proof.
5. **Real geometry.** One agent boots a copy of Julian's vault and records the evidence.
6. **Close.** Update `packages/agent-shell/docs/architecture.md`, `ARCHITECTURE.md`, the module guides, and record ADR-0059 for the Map's lint bar. A completeness critic lists what was not done.

## As built

The rebuild landed on `map-rebuild` with these departures from the tree drawn above, none of which reopens a cause the audit found:

- `MapRoot.tsx` stayed under 200 lines by moving its composition into `map-root/`: the session state that replaced the old refs, the publish pipeline in three files, the canvas callbacks, the key commands, the pure view derivation, the effect installers, the runtime reads, and the surface environments. Every file there is under 400 lines and `map-root/AGENTS.md` maps them.
- Copy lives in fourteen files under `copy/`, one per surface, re-exported through `copy.ts`.
- `canvas/strip-camera.ts` re-aims a camera fit at the strip the retained Resources panel leaves, and `layout/layout-tokens.ts` names the panel width as numbers as well as the CSS expression, so the canvas and the stylesheet agree on the inset.
- `mount-options.ts` holds the host's mount contract, and `layout/branch-priority.ts` and `surfaces/kinds/` were added.
- The Space fold runs on the key's release and is dropped by a drag, so the documented Space-drag pans; the picker's query binds ArrowDown into its listbox; a surface focuses its first control before it is painted.
- The no-unnamed-number lint reaches the strict scope only, as the kernel is kept in JavaScript. The exception the table names for `public/area-map-world-core.js` is therefore moot until the kernel is converted.

Evidence: `closing-report.md`, `real-vault.md` and the three screenshots beside it, and the nine `area-map-defect-*-browser.test.mjs` proofs under `packages/agent-shell/app/`.
