# @tangent/launcher

Purpose: Terminal launcher for opening agents and project directories in the user's preferred terminal app.

Local rules:
- Do not import vertical app packages (usage, rollup, eval, search, trees).
- Driver implementations must not block the caller — open detached or fire-and-forget.
- Config lives at ~/.tangent/launcher/config.json.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
