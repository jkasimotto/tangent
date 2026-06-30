# Layering

Preferred package-internal direction:
- cli reads args and calls sdk or command modules.
- sdk exposes package use cases and orchestrates core modules.
- core contains domain logic and app-specific storage/config.
- providers and runners wrap external provider details.
- types contain data shapes only.

Disallowed direction:
- core must not import cli.
- sdk must not import cli command handlers.
- shared platform packages must not import vertical app internals.

When a layer rule becomes enforceable, add it to @tangent/governance so future agents get a mechanical fix prompt.
