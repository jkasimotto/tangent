# @tangent/pipeline-ui Architecture

A Svelte 5 embedded app rendered inside the combined Tangent shell as the Designs tab. It is a list-detail view: the left pane lists features (title plus a muted status badge, newest-first) and the right pane renders the selected feature's Real problem block (the dominant focal point) above its Proposed design block.

Data comes from `@tangent/pipeline-server` through a `PipelineUiClient` seam, with an HTTP implementation for the running app and an in-memory implementation for component tests. The two prose sections are rendered by a self-contained `renderScopeMarkdown` (paragraphs, bold, inline code, lists) so no markdown engine is pulled in.

The newest feature is auto-selected on load; the list refetches on tab and window focus. The view is strictly read-only: no actions, no status transitions.
