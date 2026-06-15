# @tangent/usage

Local-first conversation telemetry and queryability for coding-agent sessions.

```bash
tangent usage status .
tangent usage sessions list .
tangent usage sessions report latest --provider claude --json
tangent usage sessions timeline latest --metric duration --group kind --format json
tangent usage messages query --role user --min-chars 500 --json
tangent usage analytics aggregate --session latest --metric durationMs.sum --metric tokens.total.sum --group step.kind --json
tangent usage raw events --session latest --json
```

When installed standalone as `@tangent/usage`, use the `tangent-usage` binary with the same arguments:

```bash
tangent-usage status .
tangent-usage sessions report latest --provider claude --json
```

SDK:

```ts
import { openUsage } from "@tangent/usage/core";

const usage = await openUsage({ repo: ".", index: "auto" });
const result = await usage.messages.query({
  where: { role: "user", textChars: { gte: 500 } },
  orderBy: [{ field: "createdAt", direction: "desc" }]
});
```

Compatibility exports such as `loadUsageDatasetFromIndex`, `nativeSchemaStatus`, `status`, and the legacy `UsageDataset` remain available from `@tangent/usage`.

Hidden native-log schema scaffolding:

```bash
tangent usage native schemas --provider codex
tangent usage native inspect /path/to/transcript.jsonl --json
tangent usage native status . --provider claude
```

Native transcripts are the default query source for Claude Code and Codex. Hook capture is retired; legacy usage JSONL, including old hook-sourced events, remains readable with explicit combined reads such as `--source all`.
