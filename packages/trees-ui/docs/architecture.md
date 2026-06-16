# @tangent/trees-ui Architecture

Trees UI is a Svelte app packaged as standalone assets and an embedded module for the combined Tangent UI shell.

V1 renders a tree-shaped workspace for adding semantic paths and configuring selected terminal nodes as work leaves. The default browser client reads and mutates `/api/trees/*`, while tests and isolated previews can inject the in-memory `TreesUiClient`.
