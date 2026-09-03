# Agent Notes

Purpose: the typed boundary between the Map and the kernel under `app/public/`. The kernel (the world controller, the world core, the board core, entities, figures, Find, the picker and the keyboard context) is plain JavaScript that ADR-0051 and ADR-0052 keep as it is. This directory is the only place that imports it. Design: `docs/design/area-map-rebuild/code.md`, section "The kernel boundary".

Files:

- `kernel-boundary.ts` imports `../../public/*.js` and re-exports each function the Map relies on under a typed signature. A signature is claimed once, through `typed<T>()`, and never elsewhere. The two gesture solvers are wrapped because the kernel reads a displacement as `{ x, y }` and the Map as `Delta<"scene">`; everything else is a claim with no runtime cost. The kernel is never edited for this.
- `kernel-types.ts` is the one import path for every kernel shape. It re-exports three files that stay under the module-size cap: `kernel-world-types.ts` (elements, scenes, shards, regions, the world, the composition, the gesture solvers), `kernel-facts-types.ts` (Resources, Block facts and actions, the picker, Find, the keyboard context, the kinds catalog, figure icon files) and `kernel-controller-types.ts` (the controller, its snapshot, its save and draft states, its options).
- `kernel-boundary.test.ts` names every export and proves each exists as a function or object, that the boundary exports nothing unnamed, and that the solver wrappers convert deltas both ways.

Rules here:

- Every rectangle that leaves the boundary is a `Rect<"scene">` or a `Rect<"source">`; every point a `Point<F>`; every id a brand from `../units/ids.ts`. A composed element is a `SceneElement`, a shard element a `SourceElement`; both are `MapElement<F>` and carry `RuntimeId` or `SourceId` by frame.
- Numbers the kernel exposes that no unit brand fits take the library's own type by indexed access, never `number`: an HTTP status is `Response["status"]`, an epoch timestamp `ReturnType<Date["getTime"]>`, an icon's size `HTMLImageElement["naturalWidth"]`, an element's angle `ExcalidrawElement["angle"]`.
- Server-minted strings the units do not name (`WorldId`, `WorldDigest`, `TreeDigest`, `ShardHash`, `RegionKey`, `AuthoredFingerprint`, `ResourceLocatorKey`) are branded here with `Brand<string, Name>`. They are never constructed in the Map; they arrive from the server or the kernel and are claimed with the shape that carries them.
- Excalidraw's own types come from `@excalidraw/excalidraw/types` and `@excalidraw/excalidraw/element/types`. `MapElement<F>` is the Map's element shape; a canvas module casts to `ExcalidrawElement` at the one place it hands elements to Excalidraw.
- A new kernel function the Map needs is added here with its signature, its docstring and a line in the test's `EXPECTED_EXPORTS`. No other module imports `../../public/`; the `kernel-boundary-confinement` lint fails the commit otherwise.

Tests: `node --test packages/agent-shell/app/map/kernel/*.test.ts` under Node 26. Typecheck with `tsc -p packages/agent-shell/app/map/tsconfig.json`; the tests are excluded there, so check them with a tsconfig that extends it and includes `kernel/*.test.ts`.

Read next:
- `../AGENTS.md`
- `../units/AGENTS.md`
- `docs/decisions/ADR-0051-one-composed-area-map-world.md`
- `docs/decisions/ADR-0052-one-area-layout-kernel.md`
