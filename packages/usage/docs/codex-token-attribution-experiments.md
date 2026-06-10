# Codex Token Attribution Experiments

Purpose: document reproducible Codex CLI experiments used to infer what Codex token counts represent, especially around tool calls that read files or return long command output.

Date run: 2026-06-10

Environment used:
- Codex CLI: `codex-cli 0.138.0`
- Model: `gpt-5.4-mini`
- Reasoning effort: `low`
- Sandbox for child Codex runs: `read-only`
- Fixture directory used for the original run: `/private/tmp/tangent-codex-token-exp.IoBuJL`

## Question

We want Tangent to identify what is eating tokens inside a session, not only how many tokens the whole session used. These experiments test whether Codex token usage increases because a command touches a large file, because a command returns large output to the model, or because the final turn total is aggregating multiple model calls.

## Recreate The Fixtures

Use a temp directory so no repo files are modified.

```bash
tmp="$(mktemp -d /private/tmp/tangent-codex-token-exp.XXXXXX)"
cd "$tmp"

printf 'alpha beta gamma delta epsilon zeta eta theta\n' > small.txt

for i in $(seq 0 249); do
  printf 'line %03d alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau\n' "$i"
done > large.txt

wc -c small.txt large.txt
```

The original run used:
- `small.txt`: 46 bytes
- `large.txt`: 26750 bytes

## Run The Codex Cases

The public `--json` stream reports final turn usage and visible command items. Native rollout files under `~/.codex/sessions/...` are needed for per-model-call token snapshots.

Use this command shape for each prompt:

```bash
codex exec \
  --json \
  --ignore-user-config \
  --ignore-rules \
  --sandbox read-only \
  --model gpt-5.4-mini \
  -c 'model_reasoning_effort="low"' \
  --cd "$tmp" \
  --skip-git-repo-check \
  '<prompt>' > "$tmp/<case>.jsonl"
```

Prompts used:

```text
Reply exactly ok.
Run the shell command `cat small.txt`, then after seeing the output reply exactly ok.
Run the shell command `cat large.txt`, then after seeing the output reply exactly ok.
Run the shell command `seq 1 1000`, then after seeing the output reply exactly ok.
Run the shell command `wc -c large.txt`, then after seeing the output reply exactly ok.
Run the shell command `seq 1 1000 | wc -c`, then after seeing the output reply exactly ok.
Run the shell command `cat large.txt` with max_output_tokens set to 2000, then after seeing the output reply exactly ok.
```

Notes:
- The child Codex runs may need permission to write Codex state and session files under `~/.codex`.
- Keep `--ignore-user-config`, `--ignore-rules`, and `model_reasoning_effort="low"` stable across runs. The absolute token counts include Codex's fixed prompt, tools, skills, and environment context, so they should be compared by deltas and by per-call shape rather than as standalone file-token counts.

## Parse Native Rollouts

Find the rollout files created for the temp directory if you want to inspect them manually:

```bash
find "$HOME/.codex/sessions" \
  -type f \
  -name '*.jsonl' \
  -exec grep -l "\"cwd\":\"$tmp\"" {} \;
```

The native records of interest are:
- `response_item` with `payload.type === "function_call"`
- `response_item` with `payload.type === "function_call_output"`
- `event_msg` with `payload.type === "token_count"`

This script scans native rollouts by fixture directory and exact prompt, then extracts the values used below.

```bash
FIXTURE_DIR="$tmp" node - <<'NODE'
const fs = require("fs");
const path = require("path");

const fixtureDir = process.env.FIXTURE_DIR;
if (!fixtureDir) {
  throw new Error("Set FIXTURE_DIR to the temp directory used for the Codex runs.");
}

const cases = [
  ["baseline", "Reply exactly ok."],
  ["cat small.txt", "Run the shell command `cat small.txt`, then after seeing the output reply exactly ok."],
  ["cat large.txt", "Run the shell command `cat large.txt`, then after seeing the output reply exactly ok."],
  ["seq 1 1000", "Run the shell command `seq 1 1000`, then after seeing the output reply exactly ok."],
  ["wc -c large.txt", "Run the shell command `wc -c large.txt`, then after seeing the output reply exactly ok."],
  ["seq 1 1000 | wc -c", "Run the shell command `seq 1 1000 | wc -c`, then after seeing the output reply exactly ok."],
  ["cat large max_output_tokens=2000", "Run the shell command `cat large.txt` with max_output_tokens set to 2000, then after seeing the output reply exactly ok."],
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield fullPath;
    }
  }
}

const sessionDir = path.join(process.env.HOME, ".codex", "sessions");
const byPrompt = new Map();
for (const file of walk(sessionDir)) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(fixtureDir)) continue;
  const records = text.trim().split(/\n/).filter(Boolean).map(JSON.parse);
  const cwd = records.find((record) => record.type === "session_meta")?.payload?.cwd;
  if (cwd !== fixtureDir) continue;
  const prompt = records.find((record) =>
    record.type === "event_msg" &&
    record.payload?.type === "user_message"
  )?.payload?.message;
  if (!prompt) continue;
  const existing = byPrompt.get(prompt);
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (!existing || mtimeMs > existing.mtimeMs) {
    byPrompt.set(prompt, { file, mtimeMs, records });
  }
}

console.log([
  "case",
  "tool_result_chars",
  "tool_original_tokens",
  "call1_input",
  "call2_input",
  "final_input",
  "final_cached",
  "final_output",
  "final_reasoning",
].join("\t"));

for (const [label, prompt] of cases) {
  const match = byPrompt.get(prompt);
  if (!match) {
    console.log([label, "missing"].join("\t"));
    continue;
  }
  const records = match.records;

  const output = records.find((record) =>
    record.type === "response_item" &&
    record.payload?.type === "function_call_output"
  )?.payload?.output || "";
  const originalTokens = (output.match(/Original token count: (\d+)/) || [])[1] || "";
  const tokenCounts = records
    .filter((record) => record.type === "event_msg" && record.payload?.type === "token_count")
    .map((record) => record.payload.info);
  const call1 = tokenCounts[0]?.last_token_usage || {};
  const call2 = tokenCounts[1]?.last_token_usage || {};
  const final = tokenCounts[tokenCounts.length - 1]?.total_token_usage || call1;

  console.log([
    label,
    output.length || "",
    originalTokens,
    call1.input_tokens || "",
    call2.input_tokens || "",
    final.input_tokens || "",
    final.cached_input_tokens || "",
    final.output_tokens || "",
    final.reasoning_output_tokens || "",
  ].join("\t"));
}
NODE
```

## Results

| Case | Tool result chars | Tool original tokens | Call 1 input | Call 2 input | Final input |
|---|---:|---:|---:|---:|---:|
| baseline `ok` | | | 10039 | | 10039 |
| `cat small.txt` | 149 | 12 | 10053 | 10206 | 20259 |
| `cat large.txt` | 26855 | 6688 | 9881 | 16786 | 26667 |
| `seq 1 1000` | 3997 | 974 | 10056 | 12215 | 22271 |
| `wc -c large.txt` | 121 | 5 | 9883 | 10055 | 19938 |
| `seq 1 1000 | wc -c` | 111 | 3 | 9888 | 10037 | 19925 |
| `cat large.txt`, `max_output_tokens=2000` | 8153 | 6688 | 9891 | 12081 | 21972 |

## Findings

`turn.completed.usage` is cumulative turn usage. It matches the sum of native `event_msg: token_count` `last_token_usage` snapshots for the turn.

Native Codex `token_count.info.last_token_usage` is usage for one model API call. Native Codex `token_count.info.total_token_usage` is cumulative usage across the turn.

Tool turns normally produced two model calls in these experiments:
- call 1: decide to run the tool and emit the function call
- call 2: consume the tool result and answer `ok`

The token driver is model-visible returned output, not the amount of data the command internally reads or processes:
- `cat large.txt` and `wc -c large.txt` both touched the same 26750 byte file.
- `cat large.txt` returned 26855 chars to the model-visible tool result and the second model call used 16786 input tokens.
- `wc -c large.txt` returned 121 chars to the model-visible tool result and the second model call used 10055 input tokens.

The same pattern holds for generated command output:
- `seq 1 1000` returned 3997 chars and the second model call used 12215 input tokens.
- `seq 1 1000 | wc -c` internally generated the same sequence but returned 111 chars and the second model call used 10037 input tokens.

The public CLI stream is not sufficient for model-input attribution. In the truncation case, public `command_execution.aggregated_output` showed the full command output, but native `function_call_output.output` contained a model-visible truncated payload with an omission marker like:

```text
...line 037 alpha beta gamma delta epsilon z...4688 tokens truncated...lambda mu nu xi...
```

The native `function_call_output.output` length was 8153 chars, and the second model call dropped to 12081 input tokens. Tangent should estimate tool-result input from native `function_call_output.output`, not from public `aggregated_output`.

The shell tool's `Original token count` is useful diagnostic metadata for raw command output, but it is not the same as model billing or prompt input attribution. The second model call includes tool-result envelope text, call metadata, previous assistant output, and Codex context.

## Implications For Tangent

For Codex, keep every non-duplicate native `token_count` event instead of only the final cumulative turn usage. Per-tool analysis needs `last_token_usage` snapshots, because the final `turn.completed.usage` hides which model call consumed the large payload.

For each tool call, store or derive:
- tool name and arguments
- native `function_call_output.output` char and byte size
- parsed shell `Original token count` when present
- preceding and following `last_token_usage` snapshots
- attributed next-call input tokens, using model-visible tool-result size when multiple tool results appear before the next model call

For cost reporting, treat `input_tokens` as total prompt input and `cached_input_tokens` as the cached subset. Use `input_tokens - cached_input_tokens` only when calculating uncached input cost; use total `input_tokens` when estimating context pressure.
