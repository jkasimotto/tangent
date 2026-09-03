# Agent Notes

Purpose: pointer authority, keyboard dispatch and placement for the Map. One pure function decides what a press means, one hit test decides what is under a point, and one listener owns the keys. Design: `docs/design/area-map-rebuild/code.md`, sections "Pointer authority" and "Keyboard".

Files:

- `hit-test.ts` is the one place that decides what is under a scene point. `hitTest(scene, point)` runs over a `VisibleScene` (the composition's elements and region rects, the snapshot's `hiddenIds`, `scopedAreas` and `folded`, and the zoom) and returns a `SceneHit`: the topmost visible authored element (never a region, never an ephemeral or hidden element, bound text resolved to its container), whether the point is `inside` that element's body rather than only its grab padding, and the deepest visible `area`. `visibleSceneFromSnapshot(snapshot)` builds the input; `selectedVisibleArea(scene, selection)` names the selected region's Area when it is visible; `grabPaddingAt(zoom)` is `LAYOUT.grabPadding` divided by the zoom, floored at `LAYOUT.grabZoomFloor`.
- `press-meaning.ts` exports `PressMeaning`, the closed union from the design, `PressContext`, what a press can see, and `meaningOfPress(context)`, the only decider. `PRESS_RULES` is the nine rules in the design's order, each a named function that answers or passes; a product decision on one rule changes one entry. The property test proves the function is total and deterministic, never names a hidden Area, pans whenever Space is held, never moves an ancestor from a press inside a Block, and refuses the selected Area's rotation handle.
- `pointer-session.ts` opens the gesture a meaning names, previews it through the kernel solvers and settles it through the projection.
- `excalidraw-subordination.ts` turns a `PressMeaning` into the selection Excalidraw must hold before its first move frame. It and `canvas/projection.ts` are the only writers of `selectedElementIds`.
- `keyboard-dispatch.ts` installs the one host `keydown` listener: the surface stack first, then the canvas keys. `key-routes.ts` is its table.
- `placement-point.ts` answers where B, paste and Place land: always inside the viewport, always in a visible Area from `hit-test.ts`.
- `nudge.ts` runs an arrow-key move through the same session as a pointer move.

Rules here:

- Nothing outside `press-meaning.ts` interprets a press, and nothing outside `hit-test.ts` measures a point against an element or a region. A module that needs to know what is under a point calls `hitTest`.
- A hit runs over the visible scene only. An element in `hiddenIds`, a region under a folded root, or an Area outside the Only restriction never wins a point.
- `PressContext.selectedArea` comes from `selectedVisibleArea`, so a hidden selected region never reaches the rules.
- Every numeric value is branded; the grab padding is the one screen length that crosses into the scene, through `units/scalar-math.ts` `toSceneLength`.

Tests: `node --test packages/agent-shell/app/map/input/*.test.ts` under Node 26. Typecheck with `tsc -p packages/agent-shell/app/map/tsconfig.json`; the tests are excluded there, so check them with a tsconfig that extends it, includes `input/*.test.ts` and adds `"types": ["node"]`.

Read next:
- `../AGENTS.md`
- `../kernel/AGENTS.md`
- `../units/AGENTS.md`
