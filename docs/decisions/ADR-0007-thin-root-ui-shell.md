# ADR-0007 Thin Root UI Shell

Date: 2026-06-16

## Decision

The `tangent` package is a thin universal CLI and local UI shell. It depends only on platform packages needed to render the shell and parse root commands. Vertical products such as Usage, Trees, Rollup, Eval, Search, and Governance are installed separately or represented as optional peers.

The root CLI keeps the human command taxonomy, but product code is loaded lazily inside selected command branches. The root UI discovers installed products through `package.json` `tangent.uiApp` metadata and imports only the installed product factories needed for the requested UI.

## Consequences

- `npm install tangent` does not install the full first-party suite.
- `npm install tangent @tangent/usage` means the thin shell plus Usage.
- Missing product commands fail with install guidance instead of preventing root CLI startup.
- Installed product modules that throw during import are reported as broken installed apps, not silently skipped.
- A future `tangent-suite` package may install all first-party products, but it is not part of this decision.
