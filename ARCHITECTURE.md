# Tangent Architecture

Tangent is a monorepo for local coding-agent applications. The root CLI owns the human command taxonomy and composes vertical apps plus public SDKs for product-level setup/status.

Read next:
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/architecture/layering.md
- docs/architecture/hooks.md
- docs/architecture/agent-runtime.md

Core rule: vertical apps stay independent. Shared infrastructure lives in platform packages, not in Usage and not copied app-to-app.

Allowed dependency shape:

```text
root CLI
  -> usage SDK/CLI | daily SDK/CLI | eval CLI | search SDK/CLI | governance CLI

daily -> usage, core, repo, agent-runtime
eval  -> usage, core, repo, agent-runtime
usage -> core, repo, hooks
search -> core, repo
hooks -> core, repo
repo -> core
agent-runtime -> core
governance -> core, repo
core -> no Tangent package dependencies
```

Human-facing root commands are `setup`, `status`, `usage`, `daily`, `search`, `eval`, `doctor`, and `completion`. Raw/debug/CI commands such as `governance`, `hooks`, `data export`, and `data archive` remain callable but hidden from default help.

Usage owns conversation telemetry: event schemas, datasets, SDKs, CLI, usage CLI, hook input normalization into Usage events, native transcript normalization, native-log schema compatibility checks, and assistant-centered `usage.conversation.v1` reports. Hooks owns provider config mechanics only. Native provider transcripts are high-signal but unstable telemetry inputs; Usage indexes them by default behind normalized Usage APIs and retains hooks as explicit legacy/debug capture. Daily and Eval may consume Usage data, but Usage must not learn about Daily, Eval, or Search.

Daily consumes normalized Usage conversation reports and owns the summarization workflow: `daily rollup` caches one date-level `daily.rollup-input.v1` artifact, includes style examples from explicit examples and prior notes, runs one summary provider rollup, and writes the generated note block. Daily does not parse Claude or Codex native schemas, topic rollups and turn digests are legacy/debug surfaces, and per-tool token attribution is not reported unless a provider exposes exact tool-level usage.
