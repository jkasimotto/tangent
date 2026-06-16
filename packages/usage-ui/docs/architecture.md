# @tangent/usage-ui Architecture

Usage UI is a Svelte app over `@tangent/usage-ui-data` view models. It defaults to `createUsageApiClient()` for `/api/usage/*` data and can be tested with an injected `UsageUiClient`. The package builds both a standalone app and an embedded module for the combined `tangent ui` shell.

Standalone `tangent usage ui` and embedded `tangent ui` Usage must be behaviorally identical. Both entrypoints mount through the same internal `mountUsageApp` helper, use the same `App.svelte`, and differ only by host classes needed for shell integration tests or sizing.

The default route renders the three-pane conversation workspace: project/session finder, conversation transcript, and assistant-message token/duration chart. The Svelte app consumes `UsageConversationView`; grouping, token totals, duration fallback, chart row sizing, and caveats belong in `@tangent/usage-ui-data`.

The app must keep raw provider metadata hidden and avoid importing React shared UI packages.
