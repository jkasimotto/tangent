# ADR-0008 Usage Data Packages

Date: 2026-06-16

## Decision

Rollup and Eval consume Usage through dependency-light data packages instead of the full `@tangent/usage` app.

`@tangent/usage-core` owns schemas, query helpers, projections, dataset/report types, and client construction. `@tangent/usage-providers` owns built-in provider/native transcript adapters. `@tangent/usage-index-sqlite` owns repo/native loading, optional SQLite indexing, status, archive, and compatibility SDK APIs. `@tangent/usage` remains the user-facing full app with CLI, server, UI dependencies, and compatibility exports.

## Consequences

- Rollup and Eval no longer install Usage UI packages just to read telemetry.
- `@tangent/usage-cli` is removed; `@tangent/usage` owns `tangent-usage`.
- Governance blocks Rollup/Eval from pulling `@tangent/usage`, `@tangent/usage-ui`, or `@tangent/usage-ui-data` transitively.
