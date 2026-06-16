# @tangent/trees-store-fs Architecture

Events are appended to date-partitioned JSONL files under `~/.tangent/trees/events`. Snapshots may be written as rebuildable caches.

The store does not preserve `~/.wt` as a live dependency after import.
