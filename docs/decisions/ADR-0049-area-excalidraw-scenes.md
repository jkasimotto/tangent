# ADR-0049: Area maps use Excalidraw scenes

Status: Accepted

## Context

JSON Canvas stored references, text, frames, and arrows. It did not support freehand ink, general shapes, rotation, bound connectors, or Excalidraw's direct-manipulation behavior.

The Area brain must still own facts in plain text. Julian must still own layout, style, and ink.

## Decision

Each Area can have one canonical Excalidraw scene at `<area>/<leaf>.excalidraw`.

Agent Shell embeds `@excalidraw/excalidraw` as a React browser island. The rest of the browser remains framework-free.

A Tangent entity block is a normal connectable Excalidraw shape. Its `customData.tangent` value contains an entity kind and a source reference. Its bound text is a display cache.

Agent Shell resolves block words from the current vault projection. A fact refresh can change the cache and ghost style. It cannot change geometry, user style, groups, bindings, or z-order. A fact-only refresh does not schedule a save.

Julian's edits save the complete scene after two seconds of quiet. The repository checks the loaded hash and commits only the canonical scene path. Viewport, selection, and zoom do not enter the scene file.

When only the former `<area>/<leaf>.canvas` exists, the first read converts it to Excalidraw. The conversion keeps geometry, turns file and link nodes into Tangent blocks, turns groups into frames, and turns edges into bound arrows. It adds the new file and removes the old file in one path-limited vault commit.

The Area brain can propose a block. It cannot write or move scene elements. Plain-text notes remain the fact authority.

## Consequences

Area maps get Excalidraw's text, drawing, shape, arrow, binding, touch, undo, grouping, and manipulation behavior.

Agent Shell carries a larger browser bundle and self-hosted Excalidraw fonts. The map bundle loads only when an Area map opens.

Obsidian's built-in Canvas cannot open the new file. No existing map was authored in Obsidian. A future Obsidian Excalidraw workflow can reconsider the file suffix.

Older Agent Shell versions ignore `.excalidraw` files. They do not erase them.
