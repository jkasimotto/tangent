# @tangent/usage-ui-data Architecture

This package turns Usage client results into stable view models for React apps. It also provides a browser API client for local `/api/usage/*` routes. It keeps raw provider metadata out of default views and preserves it for inspector/evidence surfaces.

Conversation cockpit mappers are pure functions. `buildUsageCockpitView` composes session finder data, hero copy, diagnostic cards, deterministic storyline chapters, trace waterfall lanes, cost breakdowns, transcript highlights, and default inspector state from Usage sessions, steps, messages, and timeline data. React components consume these DTOs without deriving product logic.
