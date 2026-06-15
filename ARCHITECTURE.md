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
  -> usage SDK/CLI | rollup SDK/CLI | eval CLI | search SDK/CLI | governance CLI

rollup -> usage, core, repo, agent-runtime
eval  -> usage, core, repo, agent-runtime
usage -> core, repo
search -> core, repo
repo -> core
agent-runtime -> core
governance -> core, repo
core -> no Tangent package dependencies
```

Human-facing root commands are `setup`, `status`, `usage`, `rollup`, `search`, `eval`, `doctor`, and `completion`. Raw/debug/CI commands such as `governance`, `data export`, and `data archive` remain callable but hidden from default help.

Usage owns conversation telemetry: event schemas, datasets, SDKs, CLI, usage CLI, native transcript normalization, native-log schema compatibility checks, legacy usage-jsonl reading, and assistant-centered `usage.conversation.v1` reports. Native provider transcripts are the source of truth for new data. Hook installation and hook recording are retired product surfaces; legacy `capture.source: "hook"` events remain readable through usage-jsonl compatibility. Rollup and Eval may consume Usage data, but Usage must not learn about Rollup, Eval, or Search.

Rollup consumes selected Usage turns and visible user messages under the configured length limit, then owns the summarization workflow: `tangent rollup <selector>` caches one period-level `rollup.input.v1` artifact, includes style examples from explicit examples and prior notes, runs one summary provider roll-up, and writes the generated note block. Assistant messages, tool calls, tool results, token metadata, and oversized pasted user messages are intentionally excluded from rollup input. Selectors support single days and compact inclusive ranges. Rollup does not parse Claude or Codex native schemas and does not preserve a topic or turn-digest architecture.

Eval owns local coding-agent evals: specs, contexts, run manifests, agent runs, metrics, reports, diffs, and the local `tangent eval ui` comparison server. Eval may read Usage metrics and git artifacts, but it does not upload eval or usage data.
