# @convos/convos

Local-first conversation telemetry and queryability for coding-agent sessions.

```bash
tangent convos status .
tangent convos hooks install --provider codex --scope repo-local
tangent convos conversations . --json
```

SDK:

```ts
import { scanRepo, status } from "@convos/convos";
```
