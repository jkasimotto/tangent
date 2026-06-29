# Eval Evaluator Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-eval rubric and judge model that scores each variant's diff + conversation at collection time, surfaced as a comparable point total and per-criterion breakdown on the compare screen.

**Architecture:** Add an `evaluator` block to the eval spec (already persisted onto the run manifest). At collection, for each variant, a new `core/evaluator.ts` builds a unified diff + a compact transcript and calls a judge model through a non-interactive `runners/judge.ts`, writing an `evaluation.json` sidecar. The server reads it and the compare UI shows a score chip + a Scoring section. The judge call is stubbed in all tests.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node --test` for `@tangent/eval`, Vitest + @testing-library/svelte for `@tangent/eval-ui`, Svelte 5 legacy mode. Tests import from compiled `dist/`.

## Global Constraints

- No em dashes anywhere (code, comments, docs, commit messages). Write full sentences.
- `@tangent/eval-ui` must NOT import `@tangent/eval`; it talks to `/api/eval/*` and keeps its own serializable copies of API types.
- Do not duplicate `runProcess`, git, or repo helpers; use `@tangent/agent-runtime/process` and `@tangent/repo/git`.
- `@tangent/core` stays out of this; no product schemas leak into it.
- Files: 400-line warning, 700-line hard error (governance). Keep new files focused.
- Pure code must not call `Date.now()`/`new Date()` for the verdict timestamp; the caller passes `now` in.
- Binary scoring only: a criterion is full points or zero. Default `points` is 1; `points` must be a positive integer.
- The judge model is required when an `evaluator` block is present. Evals without the block are never scored (backward compatible).
- Every user-visible change (score chip, Scoring section) is verified through `tangent ui` (combined shell), not a per-app surface, via `node scripts/verify-app.mjs ui` + chrome-devtools.

---

### Task 1: Spec types + evaluator config validation

**Files:**
- Modify: `packages/eval/src/types/spec.ts`
- Modify: `packages/eval/src/core/config.ts` (`validateSpec`, add `resolveCriterionPoints`)
- Test: `packages/eval/test/config.test.mjs` (add cases; create if absent)

**Interfaces:**
- Produces: `EvalCriterion = { id: string; statement: string; points?: number }`, `EvalEvaluatorSpec = { model: string; criteria: EvalCriterion[] }`, `EvalSpec.evaluator?: EvalEvaluatorSpec`, and `export function resolveCriterionPoints(points: number | undefined): number` (returns `points ?? 1`).

- [ ] **Step 1: Write the failing test**

```js
// packages/eval/test/config.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEvalSpec, resolveCriterionPoints } from "../dist/core/config.js";

async function specFile(spec) {
  const dir = await mkdtemp(path.join(tmpdir(), "eval-spec-"));
  const file = path.join(dir, "eval.json");
  await writeFile(file, JSON.stringify(spec), "utf8");
  await writeFile(path.join(dir, "p.md"), "do it", "utf8");
  return file;
}
const base = {
  schema: "eval.spec.v1", name: "x",
  cases: [{ id: "c", variants: [{ id: "v", prompt: "p.md", repo: { path: ".", ref: "HEAD" } }] }]
};

test("resolveCriterionPoints defaults to 1", () => {
  assert.equal(resolveCriterionPoints(undefined), 1);
  assert.equal(resolveCriterionPoints(3), 3);
});

test("evaluator block validates", async () => {
  const ok = await specFile({ ...base, evaluator: { model: "claude-opus-4-8", criteria: [{ id: "a", statement: "did a thing" }] } });
  const loaded = await loadEvalSpec(ok);
  assert.equal(loaded.spec.evaluator.model, "claude-opus-4-8");

  const noModel = await specFile({ ...base, evaluator: { model: "", criteria: [{ id: "a", statement: "x" }] } });
  await assert.rejects(loadEvalSpec(noModel), /evaluator.*model/i);

  const empty = await specFile({ ...base, evaluator: { model: "m", criteria: [] } });
  await assert.rejects(loadEvalSpec(empty), /criteria/i);

  const dup = await specFile({ ...base, evaluator: { model: "m", criteria: [{ id: "a", statement: "x" }, { id: "a", statement: "y" }] } });
  await assert.rejects(loadEvalSpec(dup), /duplicate|unique/i);

  const badPoints = await specFile({ ...base, evaluator: { model: "m", criteria: [{ id: "a", statement: "x", points: 0 }] } });
  await assert.rejects(loadEvalSpec(badPoints), /points/i);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/config.test.mjs`
Expected: FAIL (`resolveCriterionPoints` not exported / no validation).

- [ ] **Step 3: Add the types to `spec.ts`**

```ts
export type EvalCriterion = {
  id: string;
  statement: string;
  points?: number;
};

export type EvalEvaluatorSpec = {
  model: string;
  criteria: EvalCriterion[];
};
```
And add `evaluator?: EvalEvaluatorSpec;` to `EvalSpec` (after `defaults?`).

- [ ] **Step 4: Add validation + helper to `config.ts`**

Export `resolveCriterionPoints`:
```ts
/** A criterion's resolved point value (default 1). Binary scoring: this is awarded in full or not at all. */
export function resolveCriterionPoints(points: number | undefined): number {
  return points ?? 1;
}
```
In `validateSpec`, after the cases loop, add:
```ts
if (spec.evaluator) {
  const { model, criteria } = spec.evaluator;
  if (!model) throw new Error("Eval evaluator requires a model.");
  if (!Array.isArray(criteria) || criteria.length === 0) throw new Error("Eval evaluator requires at least one criterion.");
  const seen = new Set();
  for (const criterion of criteria) {
    if (!criterion.id) throw new Error("Eval evaluator criterion requires id.");
    if (!criterion.statement) throw new Error(`Eval evaluator criterion ${criterion.id} requires a statement.`);
    if (seen.has(criterion.id)) throw new Error(`Eval evaluator criterion id ${criterion.id} is duplicate; ids must be unique.`);
    seen.add(criterion.id);
    if (criterion.points !== undefined && (!Number.isInteger(criterion.points) || criterion.points <= 0)) {
      throw new Error(`Eval evaluator criterion ${criterion.id} points must be a positive integer.`);
    }
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/config.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/eval/src/types/spec.ts packages/eval/src/core/config.ts packages/eval/test/config.test.mjs
git commit -m "feat(eval): evaluator rubric in the spec, with validation"
```

---

### Task 2: Evaluation verdict types + judge-output parser

**Files:**
- Create: `packages/eval/src/types/evaluation.ts`
- Create: `packages/eval/src/core/verdict.ts`
- Test: `packages/eval/test/verdict.test.mjs`

**Interfaces:**
- Consumes: `EvalCriterion`, `resolveCriterionPoints` (Task 1).
- Produces:
  - `EvalCriterionVerdict = { id; statement; points: number; passed: boolean; reasoning: string }`
  - `EvalEvaluation = { schema: "eval.evaluation.v1"; caseId; variantId; model; evaluatedAt; criteria: EvalCriterionVerdict[]; totalPoints; maxPoints; warnings: string[] }`
  - `export function parseJudgeVerdict(rawText: string, ctx: { caseId; variantId; model; criteria: EvalCriterion[]; now: string }): EvalEvaluation` — extracts the JSON object/array from the model's text (tolerates surrounding prose and ```json fences), maps each rubric criterion to a verdict by id, applies `points` default, sums `totalPoints`/`maxPoints`. Unknown ids in the model output are ignored; rubric criteria the model omitted become `passed: false` with a warning. On no parseable JSON, returns zero scores with a warning. Never throws.

- [ ] **Step 1: Write the failing test**

```js
// packages/eval/test/verdict.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parseJudgeVerdict } from "../dist/core/verdict.js";

const ctx = {
  caseId: "c", variantId: "v", model: "m", now: "2026-06-30T00:00:00.000Z",
  criteria: [{ id: "a", statement: "loaded skill", points: 2 }, { id: "b", statement: "ran tests" }]
};

test("parses a fenced JSON verdict and scores it", () => {
  const raw = "Here is my assessment:\n```json\n" +
    JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "loaded it" }, { id: "b", passed: false, reasoning: "no tests" }] }) +
    "\n```";
  const e = parseJudgeVerdict(raw, ctx);
  assert.equal(e.schema, "eval.evaluation.v1");
  assert.equal(e.maxPoints, 3);
  assert.equal(e.totalPoints, 2);
  assert.equal(e.criteria.find((c) => c.id === "a").passed, true);
  assert.equal(e.criteria.find((c) => c.id === "b").points, 1);
  assert.equal(e.warnings.length, 0);
});

test("an omitted criterion fails closed with a warning", () => {
  const raw = JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "ok" }] });
  const e = parseJudgeVerdict(raw, ctx);
  assert.equal(e.criteria.find((c) => c.id === "b").passed, false);
  assert.equal(e.totalPoints, 2);
  assert.ok(e.warnings.some((w) => /b/.test(w)));
});

test("unparseable output yields zero scores and a warning, never throws", () => {
  const e = parseJudgeVerdict("the model rambled with no json", ctx);
  assert.equal(e.totalPoints, 0);
  assert.equal(e.maxPoints, 3);
  assert.equal(e.criteria.length, 2);
  assert.ok(e.warnings.length >= 1);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/verdict.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `types/evaluation.ts`**

The two exported types exactly as in Interfaces above.

- [ ] **Step 4: Write `core/verdict.ts`**

```ts
import type { EvalCriterion } from "../types/spec.js";
import type { EvalEvaluation, EvalCriterionVerdict } from "../types/evaluation.js";
import { resolveCriterionPoints } from "./config.js";

type JudgeCtx = { caseId: string; variantId: string; model: string; criteria: EvalCriterion[]; now: string };

/** Maps a judge model's free text to a scored evaluation. Tolerates prose and code fences around the JSON; never throws. */
export function parseJudgeVerdict(rawText: string, ctx: JudgeCtx): EvalEvaluation {
  const warnings: string[] = [];
  const byId = extractVerdictMap(rawText, warnings);
  const criteria: EvalCriterionVerdict[] = ctx.criteria.map((criterion) => {
    const points = resolveCriterionPoints(criterion.points);
    const found = byId.get(criterion.id);
    if (!found) warnings.push(`Judge did not return a verdict for criterion ${criterion.id}; scored as not passed.`);
    return {
      id: criterion.id,
      statement: criterion.statement,
      points,
      passed: Boolean(found?.passed),
      reasoning: typeof found?.reasoning === "string" ? found.reasoning : ""
    };
  });
  return {
    schema: "eval.evaluation.v1",
    caseId: ctx.caseId,
    variantId: ctx.variantId,
    model: ctx.model,
    evaluatedAt: ctx.now,
    criteria,
    totalPoints: criteria.reduce((sum, c) => sum + (c.passed ? c.points : 0), 0),
    maxPoints: criteria.reduce((sum, c) => sum + c.points, 0),
    warnings
  };
}

/** Pulls the first JSON object/array out of model text and indexes its criteria verdicts by id. */
function extractVerdictMap(rawText: string, warnings: string[]): Map<string, { passed?: boolean; reasoning?: unknown }> {
  const map = new Map();
  const json = firstJsonBlock(rawText);
  if (!json) { warnings.push("Judge output contained no parseable JSON; all criteria scored as not passed."); return map; }
  let parsed;
  try { parsed = JSON.parse(json); } catch { warnings.push("Judge JSON failed to parse; all criteria scored as not passed."); return map; }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  for (const row of list) {
    if (row && typeof row.id === "string") map.set(row.id, { passed: row.passed === true, reasoning: row.reasoning });
  }
  if (map.size === 0) warnings.push("Judge JSON had no recognizable criteria verdicts.");
  return map;
}

/** Returns the substring spanning the first balanced {...} or [...] in the text, or undefined. */
function firstJsonBlock(text: string): string | undefined {
  const start = text.search(/[\[{]/);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}
```
(Note: `firstJsonBlock` is a pragmatic balanced-delimiter scan; it does not account for braces inside strings, which is acceptable for judge verdicts. If a test surfaces a string-brace case, switch to counting only outside double quotes.)

- [ ] **Step 5: Run tests to confirm pass**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/verdict.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/eval/src/types/evaluation.ts packages/eval/src/core/verdict.ts packages/eval/test/verdict.test.mjs
git commit -m "feat(eval): evaluation verdict types and judge-output parser"
```

---

### Task 3: Shared transcript reconstruction in core

**Files:**
- Create: `packages/eval/src/core/transcript.ts`
- Modify: `packages/eval/src/server/conversation-view.ts` (consume the core helper; no behavior change)
- Test: `packages/eval/test/transcript.test.mjs`

**Interfaces:**
- Produces:
  - `reconstructVariantConversations(variant: EvalRunVariantState, conversationIds: Array<{ id: string }>): Promise<{ conversations: NormalizedConversation[]; notes: string[] }>` — the `loadUsageDatasetFromIndex` + `conversationReport` loop with per-conversation try/catch (lifted from `variantConversationsView`).
  - `formatTranscriptForJudge(conversations: NormalizedConversation[], worktree: string, maxChars?: number): string` — compact plain text: per assistant turn the text, optional thinking, and each tool call as `name + worktree-relativized input preview`; user turns as their text. Caps at `maxChars` (default 12000) and appends `"… [transcript truncated]"` when exceeded.
- Consumes: `loadUsageDatasetFromIndex`, `conversationReport`, `NormalizedConversation` from `@tangent/usage-index-sqlite`; the worktree-relativization already in `conversation-view.ts` (export the small `stripWorktree`/`relativeToWorktree` helpers from there, or move them into `transcript.ts` and have `conversation-view.ts` import them — pick one home, do not duplicate).

- [ ] **Step 1: Write the failing test**

```js
// packages/eval/test/transcript.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { formatTranscriptForJudge } from "../dist/core/transcript.js";

const conversations = [{
  conversationId: "claude:1", provider: "claude",
  messages: [
    { id: "u", role: "user", text: "add debug_log" },
    { id: "a", role: "assistant", model: "haiku", text: "reading", thinking: "plan",
      toolCalls: [{ id: "t", name: "Read", category: "file", input: { file_path: "/wt/lib/x.dart" }, targetPaths: ["/wt/lib/x.dart"], result: { status: "success" }, evidenceEventIds: [] }] }
  ],
  totals: { userMessages: 1, assistantMessages: 1, toolCalls: 1 }, caveats: []
}];

test("formats a compact transcript with relativized paths", () => {
  const text = formatTranscriptForJudge(conversations, "/wt");
  assert.match(text, /user:/);
  assert.match(text, /Read/);
  assert.match(text, /lib\/x\.dart/);
  assert.ok(!text.includes("/wt/lib"));
});

test("truncation marker appears past the cap", () => {
  const big = [{ ...conversations[0], messages: [{ id: "u", role: "user", text: "x".repeat(50000) }] }];
  const text = formatTranscriptForJudge(big, "/wt", 500);
  assert.ok(text.length <= 600);
  assert.match(text, /transcript truncated/);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/transcript.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `core/transcript.ts`**

Move `relativeToWorktree`/`stripWorktree` here (export them), implement `reconstructVariantConversations` (the loop currently in `variantConversationsView` lines 72-86) and `formatTranscriptForJudge`. Format each turn as:
```
user: <text>
assistant (<model>): <text>
  · thinking: <thinking>
  · <ToolName> <relativized input preview>
```
Accumulate into a string; once length exceeds `maxChars`, stop and append `"\n… [transcript truncated]"`.

- [ ] **Step 4: Refactor `server/conversation-view.ts`**

Replace the inline load+report loop in `variantConversationsView` with `reconstructVariantConversations`, and import `relativeToWorktree`/`stripWorktree` from `core/transcript.js` instead of defining them locally. `projectConversation`, `inputPreview`, and the existing route behavior are unchanged.

- [ ] **Step 5: Run the new test AND the existing conversation-view test (no regression)**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/transcript.test.mjs packages/eval/test/conversation-view.test.mjs`
Expected: PASS for both (conversation-view's 4 tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/eval/src/core/transcript.ts packages/eval/src/server/conversation-view.ts packages/eval/test/transcript.test.mjs
git commit -m "refactor(eval): share conversation reconstruction in core, add judge transcript formatter"
```

---

### Task 4: Judge runner

**Files:**
- Create: `packages/eval/src/runners/judge.ts`
- Test: `packages/eval/test/judge.test.mjs`

**Interfaces:**
- Produces:
  - `runJudge(args: { model: string; prompt: string; cwd: string; env: NodeJS.ProcessEnv; command?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<string>` — one non-interactive `claude --print --output-format stream-json --model <model>` call via `runProcess`, returning the final `result` event's text. Mirrors `runClaudeCli`'s stream-json result extraction but emits no telemetry and runs no agent loop.
  - `extractResultText(streamJsonStdout: string): string` — pure: given concatenated stream-json lines, returns the last `result` event's `result` string (exported for unit test without spawning a process).
- Consumes: `runProcess`, `processFailure` from `@tangent/agent-runtime/process`.

- [ ] **Step 1: Write the failing test** (pure extractor only; the process call is covered by Task 6's integration via stub)

```js
// packages/eval/test/judge.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { extractResultText } from "../dist/runners/judge.js";

test("extractResultText returns the final result event text", () => {
  const stdout = [
    JSON.stringify({ type: "assistant", message: { content: [] } }),
    JSON.stringify({ type: "result", result: "{\"criteria\":[]}" })
  ].join("\n") + "\n";
  assert.equal(extractResultText(stdout), "{\"criteria\":[]}");
});

test("extractResultText tolerates non-json lines and returns empty when absent", () => {
  assert.equal(extractResultText("garbage\n{not json}\n"), "");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/judge.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `runners/judge.ts`**

```ts
import { processFailure, runProcess } from "@tangent/agent-runtime/process";

/** Pulls the final stream-json `result` event text out of the judge process stdout. */
export function extractResultText(stdout: string): string {
  let resultText = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); } catch { continue; }
    if (event.type === "result" && typeof event.result === "string") resultText = event.result;
  }
  return resultText;
}

/**
 * One non-interactive judge call: prompt in, result text out. Reuses the claude `--print` stream-json
 * path the agent runner uses, but emits no telemetry and runs no tools; it exists so the evaluator can
 * score a variant with a model distinct from the agent under test.
 */
export async function runJudge(args: {
  model: string; prompt: string; cwd: string; env: NodeJS.ProcessEnv;
  command?: string; timeoutMs?: number; signal?: AbortSignal;
}): Promise<string> {
  const command = args.command || "claude";
  const result = await runProcess({
    command,
    args: ["--print", "--output-format", "stream-json", "--verbose", "--model", args.model],
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.timeoutMs || 600000,
    env: args.env,
    signal: args.signal
  });
  if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
  return extractResultText(result.stdout);
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/judge.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/runners/judge.ts packages/eval/test/judge.test.mjs
git commit -m "feat(eval): non-interactive judge runner"
```

---

### Task 5: evaluateVariant orchestration

**Files:**
- Create: `packages/eval/src/core/evaluator.ts`
- Test: `packages/eval/test/evaluator.test.mjs`

**Interfaces:**
- Consumes: `EvalEvaluatorSpec`, `EvalRunManifest`, `EvalRunVariantState`, `parseJudgeVerdict` (Task 2), `formatTranscriptForJudge` + `reconstructVariantConversations` (Task 3), `runJudge` (Task 4), `gitText` from `@tangent/repo/git`.
- Produces:
  - `composeJudgePrompt(args: { criteria; diff; transcript }): string` — pure; builds the instruction (role, the rubric as a numbered list, the strict-JSON output contract `{ "criteria": [{ "id", "passed", "reasoning" }] }`, then the diff and transcript sections).
  - `evaluateVariant(manifest, variant, evaluator, now, deps?): Promise<EvalEvaluation>` — `deps` defaults to `{ runJudge, reconstruct: reconstructVariantConversations }` so tests inject a stub judge. Reads conversation ids from the variant's `metrics.json` (via the existing reader pattern), builds diff + transcript, composes the prompt, calls `deps.runJudge`, returns `parseJudgeVerdict(...)`. On any thrown error (judge failure, git failure), returns an `EvalEvaluation` with `criteria` derived from the rubric all `passed: false` and a `warnings` entry. Never throws.

- [ ] **Step 1: Write the failing test**

```js
// packages/eval/test/evaluator.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { composeJudgePrompt, evaluateVariant } from "../dist/core/evaluator.js";

test("composeJudgePrompt includes the rubric, contract, diff and transcript", () => {
  const p = composeJudgePrompt({ criteria: [{ id: "a", statement: "loaded skill", points: 1 }], diff: "DIFFTEXT", transcript: "TRANSCRIPTTEXT" });
  assert.match(p, /loaded skill/);
  assert.match(p, /"criteria"/);
  assert.match(p, /DIFFTEXT/);
  assert.match(p, /TRANSCRIPTTEXT/);
});

test("evaluateVariant scores via an injected judge stub", async () => {
  const evaluator = { model: "judge-model", criteria: [{ id: "a", statement: "x", points: 2 }] };
  const variant = { caseId: "c", variantId: "v", worktree: "/tmp/x", baseCommit: "BASE", metricsPath: "/nope.json" };
  const deps = {
    reconstruct: async () => ({ conversations: [], notes: [] }),
    diff: async () => "diff body",
    runJudge: async () => JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "ok" }] })
  };
  const e = await evaluateVariant({ runDir: "/tmp" }, variant, evaluator, "2026-06-30T00:00:00.000Z", deps);
  assert.equal(e.totalPoints, 2);
  assert.equal(e.model, "judge-model");
});

test("evaluateVariant never throws: a judge error becomes a warning", async () => {
  const evaluator = { model: "m", criteria: [{ id: "a", statement: "x" }] };
  const variant = { caseId: "c", variantId: "v", worktree: "/tmp/x", baseCommit: "BASE", metricsPath: "/nope.json" };
  const deps = { reconstruct: async () => ({ conversations: [], notes: [] }), diff: async () => "d", runJudge: async () => { throw new Error("boom"); } };
  const e = await evaluateVariant({ runDir: "/tmp" }, variant, evaluator, "2026-06-30T00:00:00.000Z", deps);
  assert.equal(e.totalPoints, 0);
  assert.equal(e.maxPoints, 1);
  assert.ok(e.warnings.some((w) => /boom/.test(w)));
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/evaluator.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `core/evaluator.ts`**

Implement `composeJudgePrompt` and `evaluateVariant`. The `deps` parameter has optional `reconstruct`, `diff`, and `runJudge`, each defaulting to the real implementation (`reconstructVariantConversations`, `(variant) => gitText(variant.worktree, ["diff", variant.baseCommit, variant.implementationCommit || "HEAD"])`, and `runJudge`). Read the variant's conversation ids from `metrics.json` with a small local `readMetrics` (reuse the existing pattern from `metrics-read.ts`; do not import the server). Build the transcript via `formatTranscriptForJudge`, cap the diff (e.g. first 20000 chars + truncation note), compose the prompt, call the judge, and `parseJudgeVerdict`. Wrap the whole body in try/catch returning a warning-only evaluation built from the rubric.

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/evaluator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/core/evaluator.ts packages/eval/test/evaluator.test.mjs
git commit -m "feat(eval): evaluateVariant builds judge input and scores a variant"
```

---

### Task 6: Collection hook

**Files:**
- Modify: `packages/eval/src/core/metrics.ts` (`collectEval`)
- Test: `packages/eval/test/eval.test.mjs` (add a case) or a new `packages/eval/test/collect-evaluation.test.mjs`

**Interfaces:**
- Consumes: `evaluateVariant` (Task 5), `manifest.spec?.evaluator`, `variantDir` (`core/run-store.ts`).
- Produces: writes `evaluation.json` into the variant dir for each variant when `manifest.spec?.evaluator` is set.

- [ ] **Step 1: Write the failing test**

A test that builds a minimal manifest with `spec.evaluator` and a stubbed judge, runs the collection evaluation step, and asserts `evaluation.json` is written with the right totals; and that a manifest without `evaluator` writes none. Because `collectEval` calls the real `evaluateVariant`, expose the seam: have `collectEval` accept an optional `deps` (default real) OR factor the per-variant evaluation into an exported `evaluateAndWrite(manifest, variant, now, deps?)` that the test drives with a stub. Prefer the latter (smaller surface):

```js
// packages/eval/test/collect-evaluation.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateAndWrite } from "../dist/core/metrics.js";
import { variantDir } from "../dist/core/run-store.js";

test("evaluateAndWrite writes evaluation.json when the spec has an evaluator", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "eval-run-"));
  const manifest = { runDir, spec: { evaluator: { model: "m", criteria: [{ id: "a", statement: "x", points: 2 }] } } };
  const variant = { caseId: "c", variantId: "v", worktree: runDir, baseCommit: "B" };
  await mkdir(variantDir(manifest, "c", "v"), { recursive: true });
  const deps = { reconstruct: async () => ({ conversations: [], notes: [] }), diff: async () => "d", runJudge: async () => JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "ok" }] }) };
  await evaluateAndWrite(manifest, variant, "2026-06-30T00:00:00.000Z", deps);
  const written = JSON.parse(await readFile(path.join(variantDir(manifest, "c", "v"), "evaluation.json"), "utf8"));
  assert.equal(written.schema, "eval.evaluation.v1");
  assert.equal(written.totalPoints, 2);
});

test("evaluateAndWrite is a no-op without an evaluator block", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "eval-run-"));
  const manifest = { runDir, spec: {} };
  const variant = { caseId: "c", variantId: "v", worktree: runDir, baseCommit: "B" };
  await mkdir(variantDir(manifest, "c", "v"), { recursive: true });
  await evaluateAndWrite(manifest, variant, "2026-06-30T00:00:00.000Z");
  await assert.rejects(readFile(path.join(variantDir(manifest, "c", "v"), "evaluation.json"), "utf8"));
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/collect-evaluation.test.mjs`
Expected: FAIL (`evaluateAndWrite` not exported).

- [ ] **Step 3: Implement `evaluateAndWrite` and call it from `collectEval`**

```ts
/** Scores one variant against the spec rubric and writes evaluation.json, when the eval defines an evaluator. */
export async function evaluateAndWrite(
  manifest: EvalRunManifest,
  variant: EvalRunVariantState,
  now: string,
  deps?: EvaluateDeps
): Promise<void> {
  const evaluator = manifest.spec?.evaluator;
  if (!evaluator) return;
  const evaluation = await evaluateVariant(manifest, variant, evaluator, now, deps);
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "evaluation.json");
  await writeFile(file, `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
}
```
In `collectEval`, after `writeFile(variant.metricsPath, ...)`, add `await evaluateAndWrite(manifest, variant, new Date().toISOString());`. The timestamp is stamped here (impure boundary), not inside pure code.

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm run -w @tangent/eval build && node --test packages/eval/test/collect-evaluation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/core/metrics.ts packages/eval/test/collect-evaluation.test.mjs
git commit -m "feat(eval): score variants at collection, writing evaluation.json"
```

---

### Task 7: Server reader + compare view field

**Files:**
- Create: `packages/eval/src/server/evaluation-read.ts`
- Modify: `packages/eval/src/server/types.ts` (add `EvalEvaluationView` + `evaluation?` on the per-variant view)
- Modify: `packages/eval/src/server/index.ts` (populate `evaluation` where the per-variant metrics view is assembled)
- Modify: `packages/eval/docs/public-api.md`
- Test: `packages/eval/test/eval.test.mjs` (assert the compare/detail payload carries `evaluation` when `evaluation.json` exists)

**Interfaces:**
- Produces:
  - `EvalEvaluationView = { model; totalPoints; maxPoints; criteria: Array<{ id; statement; points; passed; reasoning }>; warnings: string[] }`
  - `readVariantEvaluation(manifest, variant): Promise<EvalEvaluationView | null>` — reads and validates `evaluation.json` (schema `eval.evaluation.v1`), returns null when absent.
  - `evaluation?: EvalEvaluationView` added to the existing per-variant view type returned by the compare/run-detail endpoint (locate where `readVariantMetricsView` is attached and attach `readVariantEvaluation` beside it).

- [ ] **Step 1: Write the failing test** — extend an existing run-detail/compare integration test in `eval.test.mjs`: write an `evaluation.json` into a variant dir, hit the endpoint, assert the variant view has `evaluation.totalPoints`.

- [ ] **Step 2: Run to confirm failure.** Run: `npm run -w @tangent/eval build && node --test packages/eval/test/eval.test.mjs` → FAIL.

- [ ] **Step 3: Implement `evaluation-read.ts`**, add the view types, and attach `evaluation` in `index.ts` next to the metrics view. Project `EvalEvaluation` → `EvalEvaluationView` (drop `caseId`/`variantId`/`evaluatedAt`/`schema`, keep model/points/criteria/warnings).

- [ ] **Step 4: Run tests to confirm pass.** Expected: PASS.

- [ ] **Step 5: Update `docs/public-api.md`** — document that the compare/run-detail per-variant view now includes an optional `evaluation` block, and note `evaluation.json` is written at collection when the spec defines an `evaluator`.

- [ ] **Step 6: Commit**

```bash
git add packages/eval/src/server/evaluation-read.ts packages/eval/src/server/types.ts packages/eval/src/server/index.ts packages/eval/docs/public-api.md packages/eval/test/eval.test.mjs
git commit -m "feat(eval): serve variant evaluation scores to the compare UI"
```

---

### Task 8: Compare UI — score chip + Scoring section

**Files:**
- Modify: `packages/eval-ui/src/client.ts` (mirror `EvalEvaluationView`; add `evaluation?` to the per-variant metrics view type)
- Modify: `packages/eval-ui/src/App.svelte` (score chip on the card; mount the Scoring section)
- Create: `packages/eval-ui/src/ScoringCompare.svelte`
- Modify: `packages/eval-ui/src/app.css` (chip + scoring styles)
- Modify: `packages/eval-ui/docs/index.md`, `packages/eval-ui/docs/architecture.md`
- Test: `packages/eval-ui/src/ScoringCompare.test.ts`; extend `App.test.ts`

**Interfaces:**
- Consumes: the per-variant view's `evaluation?: EvalEvaluationView` from `/api/eval/*` (Task 7). `eval-ui` defines its own copy of the type; it does NOT import `@tangent/eval`.

- [ ] **Step 1: Write the failing component test**

```ts
// packages/eval-ui/src/ScoringCompare.test.ts
import { render, screen } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import ScoringCompare from "./ScoringCompare.svelte";

const left = { model: "m", totalPoints: 2, maxPoints: 3, warnings: [],
  criteria: [{ id: "a", statement: "loaded skill", points: 2, passed: true, reasoning: "did" }, { id: "b", statement: "ran tests", points: 1, passed: false, reasoning: "no" }] };
const right = { ...left, totalPoints: 3, criteria: left.criteria.map((c) => ({ ...c, passed: true })) };

describe("ScoringCompare", () => {
  it("renders each criterion with A and B verdicts", () => {
    render(ScoringCompare, { left, right, leftLabel: "A", rightLabel: "B" });
    expect(screen.getByText("loaded skill")).toBeTruthy();
    expect(screen.getByText("ran tests")).toBeTruthy();
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure.** Run: `npm run -w @tangent/eval-ui test` → FAIL (component missing).

- [ ] **Step 3: Implement `ScoringCompare.svelte`** — a header showing each side's `totalPoints / maxPoints pts`, then one row per criterion: the statement, A's ✓/✗ and B's ✓/✗ with the points, and the judge reasoning beneath. Render `warnings` as `.convo-note`-style lines. Reuse existing compare CSS tokens.

- [ ] **Step 4: Add the score chip + section to `App.svelte`** — in the card caption area (near files-read) add `{#if metrics.evaluation}<span class="score-chip">{metrics.evaluation.totalPoints} / {metrics.evaluation.maxPoints} pts</span>{/if}`. After the Conversations section, add a collapsible Scoring section mounting `ScoringCompare` with the two variants' `evaluation` views. Update `App.test.ts`: the section count and a fake client returning an `evaluation` block.

- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run -w @tangent/eval-ui test` → PASS.

- [ ] **Step 6: Update `eval-ui` docs** — note the score chip and Scoring section in `docs/index.md` and `docs/architecture.md`.

- [ ] **Step 7: Commit**

```bash
git add packages/eval-ui/src
git commit -m "feat(eval-ui): variant score chip and Scoring comparison section"
```

---

### Task 9: ADR + example rubric + full validation

**Files:**
- Create: `docs/decisions/ADR-<n>-eval-evaluator-model.md`
- Modify: an existing eval under `evals/` (e.g. `evals/context-vs-no-context-haiku/eval.json`) to add an example `evaluator` block (the "loaded the expression-functions skill" criterion), OR document the block shape in `packages/eval/docs/index.md` if touching a real eval is undesirable.
- Modify: `ARCHITECTURE.md` / `packages/eval/docs/architecture.md` if package responsibilities shifted (the new judge runner + evaluator core).

- [ ] **Step 1: Write the ADR** — record the durable decisions: LLM-judges-everything, rubric in the eval spec, automatic at collection, required per-eval model, binary scoring. One short context/decision/consequences each.

- [ ] **Step 2: Add the example `evaluator` block** with the expression-functions criterion so the feature is exercisable on a real eval.

- [ ] **Step 3: Update eval docs** (`docs/index.md`, `docs/architecture.md`) for the new `core/evaluator.ts`, `core/transcript.ts`, `runners/judge.ts`, and the `evaluation.json` sidecar.

- [ ] **Step 4: Full validation**

Run from the worktree:
```
npm run check
npm run test
npm run governance
npm run build
```
Expected: check/build clean; eval + eval-ui suites green; governance shows only pre-existing warnings (no new file over 400 lines without reason, none over 700).

- [ ] **Step 5: Live verify** — `node scripts/verify-app.mjs ui`, open `/eval` on a run whose eval has an `evaluator` block (re-run `collect` so `evaluation.json` exists), confirm the score chip on both cards and the Scoring section showing per-criterion A/B verdicts. Check the console for errors.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions ARCHITECTURE.md packages/eval/docs evals
git commit -m "docs(eval): ADR, example rubric, and docs for the evaluator model"
```

---

## Notes for the executor

- **Pre-existing failing test:** in a clean build, `packages/usage/test/usage.test.mjs` imports `../dist/core/dataset.js`, a module that no longer exists in source (it passes on `main` only because of stale `dist`). It is unrelated to this feature. Do not try to fix it here; if `npm run test` reports it, confirm it is the only failure and that all eval/eval-ui suites are green.
- **Governance line limits:** keep `core/evaluator.ts`, `core/transcript.ts`, and `server/index.ts` under thresholds; `index.ts` is near the 700 hard limit, so attach the evaluation reader via a one-line call and keep new logic in `evaluation-read.ts`.
- **No live tokens in tests:** every judge invocation in tests goes through an injected stub (`deps.runJudge`) or the pure `extractResultText`/`parseJudgeVerdict`. Never call a real model in a test.
