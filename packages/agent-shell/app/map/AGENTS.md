# Agent Notes

Purpose: the browser Area Map. TypeScript, built by `app/build-browser.mjs` into the one `agent-shell-map.js` bundle the shell loads. Design: `docs/design/area-map-rebuild/code.md`. Read it before writing here.

Local rules, every one enforced by a lint in `scripts/lint/`:

- Logic is `.ts` and is tested under Node 26 as `*.test.ts` beside the module. Render code is `.tsx` and stays thin. A `.ts` file never imports a `.tsx` file. Every relative import names the file with its extension (`./units.ts`, `./Surface.tsx`). Only `import type` for types, no enums, no namespaces, no parameter properties: Node strips types and runs the rest.
- No file over 400 lines. No function over 80 lines. No function with more than 7 parameters. No `any`. A docstring on every function.
- The raw `number` type appears only in `units/`. Every numeric value carries a unit or a semantic brand from there: `ScreenPx`, `ScenePx`, `SourcePx`, `Zoom`, `Milliseconds`, `Count`, `Index`, `Ratio`. Points, rectangles and deltas are branded by frame. Arithmetic re-brands at the boundary through `units/scalar-math.ts`.
- A numeric literal other than 0, 1 and -1 appears only in `units/` and `layout/layout-tokens.ts`. Every layout number is named once there.
- `../public/*.js` is imported only in `kernel/`. Everything else reaches the kernel through `kernel/kernel-boundary.ts`, which brands every value on the way in.
- `input/press-meaning.ts` is the only place that decides what a pointer press means. `input/excalidraw-subordination.ts` and `canvas/projection.ts` are the only writers of `selectedElementIds`. Excalidraw's pointer props are wired only in `canvas/MapCanvas.tsx`. Host, document and window key listeners exist only in `input/keyboard-dispatch.ts`; element `onKeyDown` only in `ui/`.
- Every surface is declared once in `surfaces/surface-registry.ts` and rendered through `ui/Surface.tsx`. Only `ui/` renders `role="dialog"`, `aria-modal`, a backdrop, `autoFocus`, or calls `.focus(`.
- Only `ui/` owns CSS, `position: absolute` or `fixed`, raw interactive elements, and `z-index`. Raw colours and type live in `ui/tokens.css`; the z-index scale in `ui/layers.css`. Feature code composes the kit. No `innerHTML`, `dangerouslySetInnerHTML`, `document.createElement` or `appendChild` anywhere.
- Every sentence a person reads lives in `copy.ts`. A `*-store.ts` is a pure reducer: no fetch, timers, `Date.now`, `Math.random`, or mutating array methods.
- No file named utils, helpers, common or misc. A directory with five or more production files carries its own `AGENTS.md`.
- Duplicate code is blocked by jscpd at 45 tokens. Extract a named function instead.

Map of directories: `units/` brands; `kernel/` the typed boundary to `../public/`; `layout/` the named layout numbers; `input/` pointer authority, keyboard dispatch, placement; `canvas/` the Excalidraw host and projection; `surfaces/` one directory per surface with its store; `ui/` the kit and the CSS; `legacy/` the format-2 rollback editor; `copy.ts`, `MapRoot.tsx`, `index.tsx`.

Read next:
- `docs/design/area-map-rebuild/code.md`
- `docs/decisions/ADR-0051-one-composed-area-map-world.md`
- `docs/decisions/ADR-0052-one-area-layout-kernel.md`
