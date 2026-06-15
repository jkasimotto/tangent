# ADR-0005: Usage v2 Telemetry Kernel

Date: 2026-06-15

## Status

Accepted

## Context

Usage started as a useful dataset and CLI wrapper over normalized Claude/Codex activity. The next API needs to support scripts, dashboards, provider adapters, timelines, aggregate analytics, and future providers without forcing every caller to install SQLite or pricing dependencies.

## Decision

Keep `@tangent/usage` as one npm package for now, but expose stable dependency-light subpaths:

- `@tangent/usage/schema`
- `@tangent/usage/core`
- `@tangent/usage/query`
- `@tangent/usage/providers`
- `@tangent/usage/sqlite`
- `@tangent/usage/cli`
- `@tangent/usage/pricing`

The canonical model is normalized v3 events projected into sessions, turns, steps, messages, tool calls/results, usage samples, and raw evidence. Provider ids are open strings. SQLite is optional and acts as a rebuildable projection store, not the canonical API.

## Consequences

- Core scripts can import schema/core/query APIs without loading SQLite.
- CLI and index APIs can use SQLite when available and fail or fall back explicitly when it is not.
- Existing root exports remain as compatibility shims while Rollup/Eval migrate toward the new client APIs.
- Governance must protect the dependency-light subpath boundary and prevent reintroducing static SQLite coupling.
