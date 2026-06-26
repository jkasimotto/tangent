# @tangent/pipeline-server

Purpose: local UI server adapter that reads the feature dossier for the Designs view.

Read next:
- docs/index.md

Local rules:
- Read-only: reads `~/.tangent/features/*` files, never writes and never shells out.
- Keep server code framework-agnostic.
- Surface only the scope-stage sections; do not render the full dossier.
