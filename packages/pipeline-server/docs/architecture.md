# @tangent/pipeline-server Architecture

The pipeline server registers the Designs (`pipeline`) browser assets for the combined Tangent UI and exposes read-only `/api/pipeline/*` JSON routes backed by the on-disk feature dossier under `<tangentHome>/.tangent/features`.

It reads each feature's `feature.json` (title, status, updatedAt) and `10-scope.md`, parsing the two scope-stage sections ("Real problem" and "Minimal surgical solution") into a typed DTO at the source so the UI never re-parses markdown structure. Features lacking a `10-scope.md` are skipped. Section extraction is heading-keyed via a small ordered table, so a future full-dossier viewer adds a row rather than new parsing logic.

The route is GET-only; the verify-harness readonly guard is kept for parity even though the view never writes.
