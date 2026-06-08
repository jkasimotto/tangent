# @tangent/usage

Local-first conversation telemetry and queryability for coding-agent sessions.

```bash
tangent usage status .
tangent usage hooks install --provider codex --scope repo-local
tangent usage sessions .
tangent usage events . --json
```

SDK:

```ts
import { loadUsageDatasetFromIndex, nativeSchemaStatus, status } from "@tangent/usage";
```

Hidden native-log schema scaffolding:

```bash
tangent usage native schemas --provider codex
tangent usage native status . --provider claude
```
