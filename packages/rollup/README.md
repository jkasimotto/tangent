# @tangent/rollup

Private rollup engineering notes from `usage` conversation telemetry.

```bash
tangent rollup init . --summary-provider codex-cli --model gpt-5.4-mini
tangent rollup today
tangent rollup yesterday
tangent rollup 20260601-20260610
```

When installed standalone as `@tangent/rollup`, use the `tangent-rollup` binary with the same arguments:

```bash
tangent-rollup init . --summary-provider codex-cli --model gpt-5.4-mini
tangent-rollup today
```

`tangent rollup <selector>` reads selected Usage turns for the selected day or
inclusive compact range, fetches visible user messages only, excludes user
messages longer than `input.maxUserMessageChars` (default `8000`), writes one
`rollup.input.v1` artifact plus readable user-message and prompt artifacts, and
uses one summary provider call to write the note's generated block.

SDK:

```ts
import { getCandidates, processRollup, getRollupNote, status } from "@tangent/rollup";
```

By default, generated notes and state live outside the repo:

```txt
~/.tangent/rollup/repos/<repo-name>/
  config.json
  ledger.jsonl
  notes/
  examples/
  artifacts/
    rollups/
```

For example, this repo uses:

```txt
~/.tangent/rollup/repos/otto-tangent/
```

Override the location when initializing, or later through config:

```bash
tangent rollup init . --base-dir ~/rollup-agent-notes/otto-tangent
tangent rollup config set output.baseDir ~/rollup-agent-notes/otto-tangent
```

Use `tangent rollup path yesterday` to print a path suitable for `nvim`.
