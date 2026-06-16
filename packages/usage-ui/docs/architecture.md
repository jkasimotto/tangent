# @tangent/usage-ui Architecture

Usage UI composes shared Tangent UI components and `@tangent/usage-ui-data` view models. It defaults to `createUsageApiClient()` for `/api/usage/*` data and accepts an injected `UsageUiClient` for tests or embedding.

The default Usage route is a conversation cockpit, not an aggregate dashboard. It selects one session, then renders a left `SessionFinder`, central session hero, diagnostic cards, storyline, trace waterfall, cost breakdown, transcript highlights, and a right inspector. Raw provider evidence is progressively disclosed in the inspector, not in the main flow.
