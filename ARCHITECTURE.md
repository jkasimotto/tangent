# Tangent Architecture

Tangent is a monorepo for local coding-agent applications. The root CLI composes vertical apps and shared platform packages.

Read next:
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/architecture/layering.md
- docs/architecture/hooks.md
- docs/architecture/agent-runtime.md

Core rule: vertical apps stay independent. Shared infrastructure lives in platform packages, not in Convos and not copied app-to-app.

Allowed dependency shape:

```text
root CLI
  -> convos | daily | eval | search | governance

daily -> convos, core, repo, agent-runtime
eval  -> convos, core, repo, agent-runtime
convos -> core, repo, hooks
search -> core, repo
hooks -> core, repo
repo -> core
agent-runtime -> core
governance -> core, repo
core -> no Tangent package dependencies
```

Convos owns conversation telemetry: event schemas, datasets, SDKs, CLI, and hook input normalization into Convos events. Hooks owns provider config mechanics only. Daily and Eval may consume Convos data, but Convos must not learn about Daily, Eval, or Search.
