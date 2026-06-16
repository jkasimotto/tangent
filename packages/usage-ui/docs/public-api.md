# @tangent/usage-ui Public API

Public import paths:
- `@tangent/usage-ui`
- `@tangent/usage-ui/assets`

Important exports:
- `UsageApp`
- `UsageApp` accepts an optional `UsageUiClient` prop for tests, embedding, or alternate data transports.
- `UsageApp` renders the conversation cockpit by default and consumes `UsageCockpitView` from `@tangent/usage-ui-data`.
- `@tangent/usage-ui/assets` exports compiled static asset metadata for `@tangent/ui-server`.
