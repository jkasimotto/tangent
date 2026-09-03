# Agent Notes

Purpose: everything that opens over the Map canvas. The registry declares every surface once, the stack says which are open and what Escape does, and each surface directory holds one feature with its pure store. Design: `docs/design/area-map-rebuild/code.md`, section "Surfaces".

Files at this level:

- `surface-registry.ts` is the table from the design and nothing more: for each `SurfaceId` its `layer` (a name from `ui/layers.css`), `modality` (`panel`, `modal`, `transient`), `escape` (`close`, `back-step`, `none`), `focusOnOpen` (`heading`, `first-control`, `none`) and `restoreFocus`. `SURFACE_IDS`, `isSurfaceId()`, `surfaceDeclaration()` and `isModalSurface()` read it. Adding a surface means adding a row here and a directory below; nowhere else.
- `surface-stack.ts` is a pure reducer over the ordered list of open ids, bottom first. `openSurface` is idempotent and, for a modal, first removes any other modal on the same layer, so the stack never holds two modal surfaces on one layer. `closeSurface` removes an id and everything above it, because what is above was opened from it. `backStep` pops the top and leaves the parent open. `escape` removes the topmost surface whose declared Escape is not `none` and reports it, or reports `back` when nothing can close; a toast is passed over. `reduceSurfaceStack` is the `useReducer` reducer for `MapRoot.tsx`. Every function returns the same stack when nothing changes.

Directories: `announce/`, `save/`, `outline/`, `picker/`, `find/`, `help/`, `placement/`, `resources/`. Each holds a `*-store.ts` pure reducer with its tests and thin `.tsx` render code that composes the kit in `../ui/`.

How a surface is rendered:

- Through `../ui/Surface.tsx` only, with its registry id. The kit reads the row: a backdrop, `role="dialog"` and `aria-modal` when modal, `role="region"` otherwise; focus moved to the declared target on open; focus returned to the opener on close; Tab kept inside while modal. Children receive `close` and `backStep`.
- `../ui/Dialog.tsx` for a heading, a cause and buttons that each carry a label and an action. `../ui/Panel.tsx` for the retained side panel and `../ui/Sheet.tsx` for the same panel as a modal at narrow widths.
- Escape is not handled by a surface. `../input/keyboard-dispatch.ts` asks the stack, and the stack's answer closes or back-steps the surface through `MapRoot.tsx`.

Tests are `*.test.ts` beside each module and run with `node --test packages/agent-shell/app/map/surfaces/*.test.ts`. `surface-stack.property.test.ts` proves, over seeded random action sequences, that Escape pops exactly one, back-step leaves the parent open, opening twice is idempotent, and the stack never holds two modal surfaces on one layer.

Read next:
- `../AGENTS.md`
- `docs/design/area-map-rebuild/code.md`
