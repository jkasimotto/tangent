# Migration

Run:

```bash
tangent trees import-pa --from ~/.wt --dry-run
tangent trees import-pa --from ~/.wt
```

The importer maps old entities, pulses, inbox items, and legacy session sidecars into typed Trees events and observations. It does not keep reading `~/.wt` after import unless rerun.
