# Agent Notes

Purpose: the composition of the Map. `../MapRoot.tsx` holds the React state and the render; every module here is one part of the wiring it needs. Design: `docs/design/area-map-rebuild/code.md`, sections "State", "Pointer authority" and "Surfaces".

Files:

- `map-session.ts` is the Map's mutable state outside React, in one object with named fields: the Excalidraw api, the Space flag, the last pointer point, the claimed identities of elements Excalidraw minted, the paste and text placement windows, the non-pointer command, and the openers focus returns to. It replaced the sixty refs of the old component.
- `map-root-controller.ts` decides where the controller comes from. A controller the host passed is used as it is; otherwise one is created from the mount options and the Map owns its life. `emitAreaMapEvent` forwards every diagnostic to the host's `onEvent` and to the `tangent:area-map` custom event the browser suites listen for.
- `map-publish.ts` is the one function that turns an Excalidraw change into world authority: the baseline it measures against, the elements it restores, the owners it claims, the Blocks it corrects, the shards it writes, and the command it lands in. `map-publish-claims.ts` decides which shard a new element belongs to and which Blocks an arrow binds; `map-publish-shards.ts` writes the shard scenes, corrects a dragged Block through the kernel's owned-element solver, and re-anchors an Area whose content hull changed.
- `map-root-canvas.ts` answers every Excalidraw callback: a press becomes a `PressContext`, `input/press-meaning.ts` decides it, `input/excalidraw-subordination.ts` subordinates the selection, `input/pointer-session.ts` opens the gesture, and a change is either a fenced echo, a buffered text edit, or a publish.
- `map-root-commands.ts` runs the `KeyCommand` values `input/keyboard-dispatch.ts` routes. Nothing here reads an event, so a toolbar button and its key run the same code.
- `map-root-view.ts` is the pure derivation of one render: the merged documents, the Area names, the Block resolver, the name pills and the Outline tree, so no two surfaces say different words about one Area.
- `map-root-effects.ts` holds the installers the root's effects call: the controller subscription, the announce clock, the projection push and the shell inert guard.
- `map-runtime.ts` builds the reads every surface shares and the publish dependencies; `map-runtime-surfaces.ts` builds one environment per surface from them.
- `use-map-core.ts` builds the long-lived objects once (the projection fence, the pointer session, the text buffer, the icon registry, the canvas handlers ref); `use-map-stores.ts` holds one `useReducer` per surface store; `use-map-wiring.ts` assembles them into the records each module declared; `use-map-effects.ts` installs every effect.
- `MapToolbar.tsx` is the top-right control row and `MapSurfaces.tsx` renders every registered surface.

Rules here:

- Nothing in this directory renders CSS, positions, moves focus or listens for a key: the kit under `../ui/` and `../input/keyboard-dispatch.ts` own those.
- Every sentence comes from `../copy.ts` and every number from `../layout/layout-tokens.ts` or a brand in `../units/`.
- A module here takes what it needs as a typed dependency record. Nothing reaches for a global, and nothing reads another surface's store directly.

Tests: the browser suites under `packages/agent-shell/app/area-map-*.test.mjs` cover this directory end to end; typecheck with `tsc -p packages/agent-shell/app/map/tsconfig.json`.

Read next:
- `../AGENTS.md`
- `docs/design/area-map-rebuild/code.md`
