# Agent Notes

Purpose: Prepare, run, collect, compare, and report coding-agent eval variants. Also owns the mark loop's store: the `tangent.mark.v1` record, its per-file JSON store, mark-to-eval promotion, and the marks inbox API behind the Eval UI.

Local rules:
- Eval may consume Usage metrics.
- Keep eval specs, contexts, and manifests in Eval.
- Marks live here, not in a new package or in Usage; see ADR-0015.
- There is no `tangent mark` CLI command; it was removed 2026-08-15 (ADR-0020). Do not re-add a top-level mark command. The marks store, scan, and to-eval modules stay and are read by the Eval UI's marks inbox.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
