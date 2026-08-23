# ADR-0019: Delete the combined `tangent ui` shell

Date: 2026-08-14

Status: accepted

## Context

The combined `tangent ui` launcher mounted Usage, Eval, and Work inside the `@tangent/tangent-ui` Svelte shell. Package manifests supplied the `tangent.uiApp` discovery data.

The user's daily product moved to Agent Shell (`packages/agent-shell/app/server.mjs`, port 4321). Agent Shell runs on the `@tangent/agent-shell` engine.

The combined shell was no longer used. Its instructions still sent coding agents to that dead surface and caused repeated confusion.

## Decision

Delete the combined UI completely:

- `packages/tangent-ui` (the Svelte shell) and `packages/agent-shell-ui` (the embedded Work app bundle).
- The `tangent ui` command, `src/cli/ui-discovery.ts`, and the shell-only route modules `src/cli/worklog.ts`, `src/cli/focus.ts`, `src/cli/feedback.ts`.
- `tangent.uiApp` manifest descriptors and the embed factory `createAgentShellUiApp` (`packages/agent-shell/src/server.ts`).
- All current-state doc references, governance entries, and smoke targets.

Keep:

- Agent Shell as the daily product: prototype server plus `@tangent/agent-shell` engine.
- `tangent usage ui` and `tangent eval ui` as standalone secondary analysis surfaces. Their servers mount the internal app registrations.
- `@tangent/ui-server` and `@tangent/ui-tokens` as shared infrastructure.

## Consequences

- There is no combined browser shell and no app discovery. Do not restore the command, shell package, or manifest descriptors.
- Verify Agent Shell through its prototype server. Verify Usage or Eval through `node scripts/verify-app.mjs [usage|eval]`.
- The worklog, focus, and feedback HTTP capture surfaces died with the shell. Their data files under `~/.tangent/` remain readable history.
- Historical ADRs, plans, and specs still mention `tangent ui`; they describe the past and are superseded by this ADR.
