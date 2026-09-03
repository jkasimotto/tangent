# Agent Notes

Purpose: the brand owners of the Map. These are the only files under `app/map/` allowed to say `number`, and the only place a raw string becomes an id. Everything else imports a brand from here and re-brands at the boundary through `scalar-math.ts`. Design: `docs/design/area-map-rebuild/code.md`, section "Units and frames".

Files:

- `brand.ts` is `Brand<T, Name>`, a `T` with a compile-time `__brand`. Brands do not nest: two disjoint `__brand` literals reduce the type to `never`, so every brand is declared directly on its base type.
- `units.ts` holds the scalars and their constructors: `ScreenPx` / `screenPx()`, `ScenePx` / `scenePx()`, `SourcePx` / `sourcePx()`, `Zoom` / `zoom()`, `Milliseconds` / `milliseconds()`, `Count` / `count()`, `Index` / `index()`, `Ratio` / `ratio()`, `Percent` / `percent()`. `Zoom` is a ratio by meaning and its own brand by type, because a zoom must not pass for a proportion. `Percent` is a share out of one hundred, the way Excalidraw measures opacity, and is its own brand for the same reason.
- `frames.ts` holds the three frames and the shapes branded by them. `screen` is CSS pixels relative to the canvas, `scene` is Excalidraw's composed world, `source` is shard-local. `Point<F>`, `Delta<F>`, `Size<F>` and `Rect<F>` are built by `point()`, `delta()`, `size()` and `rect()`, each taking the frame name first because a frame cannot be inferred from a pixel brand. `Camera` is the scroll offset in scene pixels and the zoom.
- `ids.ts` holds `AreaKey`, `RuntimeId`, `SourceId`, `ShardOwner`, `WorldRevision`, `ResourceId` with their constructors, and the `ResizeHandle` union with `RESIZE_HANDLES` and `isResizeHandle()`.
- `scalar-math.ts` does the arithmetic and re-brands the result: `add`, `subtract`, `scale`, `half`, `clamp`, `midpoint`, `distance`, `translate`, `deltaBetween`, `rectCenter`, `rectContains`, `rectsOverlap`, `inflate`, `union`, and the two frame crossings `toScene` and `toScreen`. Those two are the only place the camera conversion is written.

How to use them:

- Pick the brand by what the value means. A pointer coordinate is `ScreenPx`; a composed element's box is `Rect<"scene">`; a stored element's box is `Rect<"source">`; a timeout is `Milliseconds`; a list length is `Count`; a Find position is `Index`.
- Never spell `number`. Write `scenePx(a + b)` or call `add(a, b)`. A branded value satisfies a library slot that wants a number without a cast, because it is one.
- A frame constructor takes the frame name: `point("scene", x, y)`. The compiler then requires `x` and `y` to carry that frame's pixel unit.
- Cross frames only through `toScene` and `toScreen`, and reach the source frame only through `kernel/kernel-boundary.ts`.
- `T[number]` indexed access is not a quantity and is allowed everywhere.

Tests are `*.test.ts` beside each module and run with `node --test packages/agent-shell/app/map/units/*.test.ts`. They include `@ts-expect-error` lines that prove the brands reject what they must; check them with a tsconfig that includes the tests, since the module tsconfig excludes them.

Read next:
- `../AGENTS.md`
- `docs/design/area-map-rebuild/code.md`
