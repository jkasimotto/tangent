# @tangent/daily

Private daily engineering notes from `usage` conversation telemetry.

```bash
tangent daily init . --summary-provider codex-cli --model gpt-5.4-mini
tangent daily rollup . --date today
tangent daily today
tangent daily yesterday
```

`daily rollup . --date <day>` reads normalized Usage conversation reports for the
selected day, writes one rollup input artifact plus readable messages and prompt
artifacts, and uses one summary provider call to write the note's generated
block. `daily process` remains an alias.

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
  examples/
  artifacts/
    rollups/
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
