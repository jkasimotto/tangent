# ADR-0051: Compose one Area map world from source shards

Status: Accepted

Date: 2026-08-30

## Context

Each Area owns one Excalidraw source scene. The former editor opened one scene and showed ancestors as locked projections.

That model gave the open scene special authority. It also let child outlines cross a projected parent boundary.

The Area tree already defines the complete hierarchy. Map navigation must not replace that structural authority.

One pointer action can change several source shards. A process error must not expose a partial action to Agent Shell readers.

## Decision

Agent Shell composes one browser world from all Area source shards. The Area tree supplies one live region for each Area.

The `@root` shard owns regions for top-level Areas. Each other parent shard owns its direct-child regions.

Source coordinates stay local to the owning shard. Runtime IDs include the source owner and source ID.

The controller owns selection, history, loading, conflicts, drafts, and the camera trail. Excalidraw renders this controller state.

The containment solver starts from the pointer-down source snapshot. It expands computed ancestor outlines in the same frame.

Stored rectangles are size floors. Automatic ancestor growth does not write those rectangles.

Sibling regions are walls. A parent region expands for its child until an unselected sibling blocks that expansion.

Camera, Focus, fold, and semantic zoom are view masks. These masks do not select source shards or remove structural authority.

The server accepts source-space mutations only. One transaction commits all affected shards through a temporary Git index.

The transaction uses a durable journal, a cross-process lock, and a compare-and-swap branch update. Agent Shell blocks map reads during installation.

Startup recovery completes one recognized old or new transaction state. Unrelated target bytes put map writes into recovery-required state.

## Consequences

Opening any Area shows its complete ancestor and descendant structure. Every visible Area region stays unlocked and interactive.

Map gestures preserve Area membership. Only an explicit Area command changes a source owner.

Undo and redo operate on world commands. View changes do not enter this history.

One map gesture produces one Git commit. Unrelated staged and working-tree changes stay unchanged.

The old `/api/areas/canvas` reader stays available during rollback. New writes use the world transaction path.

The former scope projections remain migration input only. Production world code does not use locked ancestors as a fallback.

## Rollback

Disable the `areaMapWorld` browser path only after startup recovery finishes. The format-2 source scenes remain readable by the old reader.

Do not do a bulk vault rewrite. Read migration stays incremental until the rollback period ends.

## Related decisions

- ADR-0048 records the former JSON Canvas authority.
- ADR-0049 selects Excalidraw source scenes.
- The approved product and engineering designs define the interaction and recovery details.
