# Agent Notes

Purpose: the Excalidraw host and everything between the controller and Excalidraw: the projection fence, buffered text edits, figure icon registration, and the Area name pills over the canvas. Design: `docs/design/area-map-rebuild/code.md`, section "Structure", `canvas/`.

Files:

- `MapCanvas.tsx` is the one component that renders `<Excalidraw>`. It is memoised over a stable `initialData` and a `handlers` ref, so the root repaints without remounting the editor. Excalidraw's `onPointerDown`, `onPointerUp` and `onPointerUpdate` are wired here and nowhere else (pointer-confinement lint). Pointer down and up are forwarded with Excalidraw's own signatures because the kernel reads the raw `PointerDownState`; the pointer update becomes a `Point<"scene">` and the scroll callback a `Camera`, so no other module reads Excalidraw's raw numbers. `autoFocus` is not passed: only the kit moves focus.
- `projection.ts` is the fence. `Projection.project(request, reason)` pushes elements, a selection or a cleared text editor into Excalidraw with `captureUpdate: "NEVER"` and records the echo to expect; `consume(elements, appState)` recognises that echo in `onChange` and swallows it; `absorbFencedChange(elements)` settles a change that arrived under a pending element push with no user command open; `defer` queues a push for after the current React lifecycle and `cancel` lets a new user command supersede it. It is one of the two writers of `selectedElementIds` (the other is `input/excalidraw-subordination.ts`, which applies its answer through here): callers pass a selection as ids and the fence builds the record. `selectedIds`, `selectionKey`, `selectionAppState`, `asSceneElements` and `asExcalidrawElements` are the shared readers, the one selection builder, and the two casts at the Excalidraw boundary. The api, the scheduler and the clock are injected.
- `text-edit.ts` holds the live text edit with named state. `captureLiveTextEdit` buffers a change that arrived with the editor open; `finishTextEdit` merges the last buffered text into the elements the closing editor hands back; `finishBufferedTextEdit` forces that finish after a finishing key; `staleEditingText` decides whether Excalidraw is editing an id the scene no longer holds and which selection the repair projects.
- `icon-files.ts` prepares image icons for the theme (`prepareFigureIconImages`, rasterizing an SVG to a PNG under the dark theme through an injected rasterizer) and registers icon bytes with Excalidraw exactly once (`IconFileRegistry.register`), emitting the `map-icon-files` diagnostic the figure-images suite listens for. `MAP_THEME` lives here.
- `area-label-model.ts` is the pure model of the name pills: `areaRecords`, `areaName`, `areaPathName`, `areaParentName`, `accessibleAreaName` (the exact format the browser suites and the Outline rows share), `areaRuntimeAnnotations`, `labelNotes`, `labelPosition` and `areaLabelModels`. `AreaLabels.tsx` renders those models through the kit's `CanvasLabel` and `CanvasFacts` and nothing else.

Rules here:

- A `.ts` file never imports a `.tsx` file. The two render files stay thin: no arithmetic, no words, no state.
- Every sentence comes from `../copy.ts`; every number from `../layout/layout-tokens.ts` or a brand in `../units/`.
- Elements cross into Excalidraw's type only through `asExcalidrawElements` and back only through `asSceneElements`, both in `projection.ts`.
- Nothing here calls `document.createElement`, writes a style, or renders a raw button: the pills and the facts row are kit parts.

Tests: `node --test packages/agent-shell/app/map/canvas/*.test.ts` under Node 26. The `.tsx` files are checked with `tsc -p packages/agent-shell/app/map/tsconfig.json` and covered by the browser suites.

Read next:
- `../AGENTS.md`
- `../ui/AGENTS.md`
- `docs/design/area-map-rebuild/code.md`
