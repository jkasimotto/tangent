# @tangent/usage-ui Architecture

Usage UI composes shared Tangent UI components and `@tangent/usage-ui-data` view models. It defaults to `createUsageApiClient()` for `/api/usage/*` data and accepts an injected `UsageUiClient` for tests or embedding. Session detail uses master/detail with default summaries, timeline, transcript preview, caveats, and next actions.
