# ADR-0052: Use one Area layout kernel

Status: Accepted

Date: 2026-08-31

## Context

ADR-0051 made unselected sibling Areas into hard walls. A live nested corner resize reached a sibling before it changed any ancestor size.

The server and browser also calculated Area requirements with separate implementations. Pointer capture started the same physical gesture through two event paths.

New content and deeper descendants need automatic space. Direct user movement still needs to preserve intentional overlap.

## Decision

One framework-neutral kernel resolves geometry for the complete Area tree. Its layout constants and nearest-free operation are shared by the server read adapter, browser controller, pointer preview, and tests.

Each direct-child region remains compatible authored source in its parent shard. Optional `area-placement.v1` metadata records stable branch priority and exact user-created overlap pairs.

The kernel computes content requirements from the leaves upward. It arranges colliding branches by the smallest valid two-dimensional translation on the side the authored rectangles already put the branch on, then projects world transforms from the root downward. Authored rectangles do not move while a gesture runs, so the side does not change between preview frames and a reflowed sibling slides instead of jumping to another axis.

Automatic placement checks existing Area regions and authored content. Placement, content growth, and region resize reflow sibling branches. They do not create new sibling overlap.

A direct Area move can record an exact symmetric overlap exception. One-sided metadata cannot disable automatic spacing. A moved Area carries its subtree without changing descendant-local coordinates.

A structural block edit first anchors its owner at the current resolved position. A priority change cannot move the edited Area back to an older preferred position.

Ancestor growth and automatic sibling offsets are derived. They do not create source writes outside the explicit command intent.

Excalidraw remains the React rendering island. Its typed pointer callbacks are the only structural pointer input, and the exact resize handle defines the command.

The projection puts all transparent Area outlines below authored content. A nested outline cannot intercept a click on visible ancestor content.

The transaction repository remains unchanged. It atomically saves the source elements changed by one command.

## Consequences

A nested resize can expand every ancestor and move affected siblings in one resolved snapshot. Reload recomputes the same layout from persisted intent.

Valid legacy rectangles keep their exact positions. The read adapter converts existing overlaps into in-memory exceptions and writes metadata only after a later user command.

The first related structural command writes both halves of each legacy overlap pair. A path move removes any overlap pair whose remapped Areas are no longer direct siblings.

Deferred shard summaries must contain the same content hulls used by ready shards. Materializing a shard for one world revision cannot change geometry.

The browser can expose the actual Excalidraw elements to production-path tests. Controller projections are not sufficient proof of a rendered frame.

## Rejected alternatives

Keeping sibling walls conflicts with automatic spacing and caused the live failure.

Persisting all automatic shifts would spread source changes through unrelated parent shards.

Replacing React with Svelte or Vue would still require a React Excalidraw island and another scheduling boundary.

## Related decisions

- ADR-0049 selects Excalidraw source scenes.
- ADR-0051 defines the composed world, source ownership, and transaction boundary.
- ADR-0052 replaces only the sibling-wall and competing-layout parts of ADR-0051.
