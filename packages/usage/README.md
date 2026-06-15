# @tangent/usage

Local-first conversation telemetry and queryability for coding-agent sessions.

```bash
tangent usage status .
tangent usage sessions .
tangent usage report latest --provider claude --json
tangent usage tokens latest
tangent usage events . --json
```

When installed standalone as `@tangent/usage`, use the `tangent-usage` binary with the same arguments:

```bash
tangent-usage status .
tangent-usage report latest --provider claude --json
```

SDK:

```ts
import { loadUsageDatasetFromIndex, nativeSchemaStatus, status } from "@tangent/usage";
```

Hidden native-log schema scaffolding:

```bash
tangent usage native schemas --provider codex
tangent usage native inspect /path/to/transcript.jsonl --json
tangent usage native status . --provider claude
```

Native transcripts are the default query source for Claude Code and Codex. Hook capture is retired; legacy usage JSONL, including old hook-sourced events, remains readable with explicit combined reads such as `--source all`.
