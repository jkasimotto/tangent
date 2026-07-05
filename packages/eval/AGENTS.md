# Agent Notes

Purpose: Prepare, run, collect, compare, and report coding-agent eval variants. Also owns the mark loop's capture surface: the `tangent.mark.v1` record, its store, and the `tangent mark` CLI.

Local rules:
- Eval may consume Usage metrics.
- Keep eval specs, contexts, and manifests in Eval.
- Marks live here, not in a new package or in Usage; see ADR-0015.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
