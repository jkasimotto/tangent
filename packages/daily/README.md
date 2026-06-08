# @tangent/daily

Private daily engineering notes from `usage` conversation telemetry.

```bash
tangent daily init . --summary-provider codex-cli --model gpt-5.4-mini
tangent daily process . --date today
tangent daily today
tangent daily yesterday
```

SDK:

```ts
import { getUnprocessed, processUnprocessed, getDailyNote, status } from "@tangent/daily";
```

By default, generated notes and state live outside the repo:

```txt
~/.tangent/daily/repos/<repo-name>/
  config.json
  ledger.jsonl
  notes/
  digests/
  artifacts/
```

For example, this repo uses:

```txt
~/.tangent/daily/repos/otto-tangent/
```

Override the location when initializing, or later through config:

```bash
tangent daily init . --base-dir ~/daily-agent-notes/otto-tangent
tangent daily config set output.baseDir ~/daily-agent-notes/otto-tangent
```

Use `tangent daily yesterday` to print a path suitable for `nvim`.
