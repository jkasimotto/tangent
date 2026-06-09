# @tangent/usage

Local-first conversation telemetry and queryability for coding-agent sessions.

```bash
tangent usage status .
tangent usage sessions .
tangent usage tokens latest
tangent usage events . --json
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

Native transcripts are the default query source for Claude Code and Codex. Hook capture is still available for legacy/debug use through `tangent usage hooks install`, and hook JSONL can be queried explicitly with `--source hooks`.
