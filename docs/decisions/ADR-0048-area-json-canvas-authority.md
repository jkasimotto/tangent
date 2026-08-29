# ADR-0048: Area JSON Canvas authority

Status: Superseded by ADR-0049

## Context

Each Area needs a living spatial map. The map contains references, text, frames, arrows, and Julian's layout.

The Area brain maintains facts in plain-text notes. The brain can also propose new references.

JSON Canvas gives Tangent a format that Obsidian can read. The standard has no fields for fold state or proposal state.

## Decision

Each Area can have one canonical JSON Canvas file. Its path is `<area>/<leaf>.canvas`.

The canvas contains only JSON Canvas 1.0 fields. Tangent blocks writes if a file contains unsupported fields.

Plain-text notes remain the authority for facts. Tangent resolves file nodes from the current vault projection.

Julian owns the canvas content and geometry. A brain cannot write or move canvas nodes.

Brain pictures, proposals, and promotion progress use runtime records. These records do not own facts or geometry.

Tangent saves the complete canvas with a base hash. A stale hash returns a conflict and does not replace the file.

Each successful save commits only the canonical canvas path. Tangent keeps an uncommitted save visible as a recovery error.

View state stays outside the canvas. This state includes pan, zoom, folds, filters, and inline child state.

## Consequences

Obsidian can read and write every supported Area canvas.

Fact refresh does not move Julian's layout. A missing source becomes a ghost node and stays on the map.

The proposal inbox cannot move the map before Julian accepts a proposal.

Tangent cannot store folded groups in the JSON Canvas file. Another editor shows the full authored map.

Older Agent Shell versions ignore canvas files and runtime records. They do not erase these files.
