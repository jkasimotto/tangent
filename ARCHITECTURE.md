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

Usage owns conversation telemetry: event schemas, datasets, SDKs, CLI, usage CLI, hook input normalization into Usage events, and native-log schema compatibility checks. Hooks owns provider config mechanics only. Native provider transcripts are treated as high-signal but unstable telemetry inputs; Usage may inspect and version-gate them, but product flows should consume them only through normalized Usage APIs. Daily and Eval may consume Usage data, but Usage must not learn about Daily, Eval, or Search.
