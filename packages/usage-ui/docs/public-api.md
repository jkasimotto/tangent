# @tangent/usage-ui Public API

Public import paths:
- `@tangent/usage-ui`
- `@tangent/usage-ui/assets`

Important exports:
- `@tangent/usage-ui` currently has no component export; the browser app entry is built by Vite.
- `@tangent/usage-ui/assets` exports compiled static asset metadata for `@tangent/ui-server`.
- Embedded browser assets include `/embedded.js`, which exports `mountApp(target, context)` for the combined Tangent UI shell.
