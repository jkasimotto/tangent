# UI Package Boundaries

- `ui-tokens`: no React and no product imports.
- `ui-primitives`: low-level accessible controls.
- `ui-components`: generic product components, not Usage/Eval/Rollup mappers.
- `ui-patterns`: repeated UX workflows and page templates.
- `ui-charts`: visualizations with table fallback and export.
- `ui-code`: code, diff, markdown, transcript, JSON, and file renderers.
- `ui-app-shell`: one shell for all product apps.
- `*-ui-data`: React-free DTO builders and client adapters.
- `*-ui`: product screens composed from shared UI packages.
