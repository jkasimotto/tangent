# @tangent/trees-store-fs

Purpose: canonical V1 filesystem event store for Tangent Trees.

Rules:
- Treat event JSONL files as canonical and snapshots as caches.
- Do not read legacy `pa` state unless an explicit import command asks for it.

Read next:
- docs/index.md
