# ADR-0009 Trees Runtime Consolidation

Date: 2026-06-16

## Decision

Trees runtime adapters are consolidated into `@tangent/trees-runtime` with explicit subpath exports:

- `@tangent/trees-runtime/fs`
- `@tangent/trees-runtime/sqlite`
- `@tangent/trees-runtime/git`
- `@tangent/trees-runtime/terminal`
- `@tangent/trees-runtime/agents`
- `@tangent/trees-runtime/attention`

`@tangent/trees-schema`, `@tangent/trees-core`, `@tangent/trees-mcp`, `@tangent/trees-cli`, `@tangent/trees-ui`, and `@tangent/trees-server` remain separate packages.

## Consequences

- Runtime boundaries stay explicit in source without publishing every unstable adapter as its own package.
- Trees CLI and server depend on one runtime package instead of six granular runtime packages.
- MCP stays separate as an adapter surface.
