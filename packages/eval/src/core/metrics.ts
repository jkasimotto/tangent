import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { changedFiles, currentCommit, diffStat, statusPorcelain } from "@tangent/repo/git";
import { commitAll } from "@tangent/repo/worktree";

import { scanRepo, type UsageJsonlLineV1 } from "@tangent/usage-index-sqlite";

import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { evaluateVariant, type EvaluateDeps } from "./evaluator.js";
import { loadRunManifest, saveRunManifest, variantDir } from "./run-store.js";

/** Collects metrics for every variant in a run and writes metrics.json and evaluation.json for each. */
export async function collectEval(idOrManifest: string | EvalRunManifest): Promise<{ manifest: EvalRunManifest; metrics: EvalMetrics[] }> {
  const manifest = typeof idOrManifest === "string" ? await loadRunManifest(idOrManifest) : idOrManifest;
  const rows: EvalMetrics[] = [];
  for (const variant of manifest.variants) {
    await captureManualTail(variant);
    const metrics = await collectVariantMetrics(manifest, variant);
    await writeFile(variant.metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
    try {
      await evaluateAndWrite(manifest, variant, new Date().toISOString());
    } catch (error) {
      variant.warnings ??= [];
      variant.warnings.push(`evaluation failed: ${(error as Error).message}`);
    }
    rows.push(metrics);
  }
  await writeFile(path.join(manifest.runDir, "report.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await saveRunManifest(manifest);
  return { manifest, metrics: rows };
}

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

/** Commits any uncommitted work in a manual variant's worktree so metrics can reference a stable commit. */
async function captureManualTail(variant: EvalRunVariantState): Promise<void> {
  if (variant.agent.kind !== "manual") return;
  const head = await currentCommit(variant.worktree).catch(() => undefined);
  const dirty = await statusPorcelain(variant.worktree).catch(() => "");
  if (dirty) {
    variant.implementationCommit = await commitAll(variant.worktree, `eval: implement ${variant.caseId} / ${variant.variantId}`);
    variant.endedAt ||= new Date().toISOString();
    return;
  }
  if (head && head !== variant.contextCommit && head !== variant.planCommit) {
    variant.implementationCommit ||= head;
    variant.endedAt ||= new Date().toISOString();
  }
}

/** Computes one variant's metrics from the usage index and git; the window ends "now" while the variant still runs, so the Eval UI can reuse it for a live snapshot before collectEval writes metrics.json. */
export async function collectVariantMetrics(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalMetrics> {
  const since = variant.startedAt || manifest.createdAt;
  const until = variant.endedAt || new Date().toISOString();
  const worktreeAliases = await pathAliases(variant.worktree);
  const scan = await scanRepo({
    repo: variant.worktree,
    providers: ["claude", "codex"],
    sources: ["native", "usage-jsonl"],
    since: new Date(since),
    until: new Date(until)
  }).catch((error) => {
    variant.warnings.push(`usage scan failed: ${(error as Error).message}`);
    return undefined;
  });

  const events = (scan?.events || []).filter((event) => eventInVariant(event, worktreeAliases, since, until));
  const conversations = uniqueConversations(events);
  const toolStats = toolMetrics(events);
  const tokenStats = tokenMetrics(events);
  const fileStats = fileMetrics(events);
  const commandStats = commandMetrics(events);
  const implementationCommit = variant.implementationCommit || await currentCommit(variant.worktree).catch(() => undefined);
  const changed = await changedFiles(variant.worktree, variant.baseCommit, implementationCommit || "HEAD").catch(() => []);
  const stat = await diffStat(variant.worktree, variant.baseCommit, implementationCommit || "HEAD").catch(() => undefined);

  const planPhase = variant.phases.find((phase) => phase.id === "plan");
  const implPhase = variant.phases.find((phase) => phase.id === "implement");
  const metrics: EvalMetrics = {
    schema: "eval.metrics.v1",
    runId: manifest.id,
    caseId: variant.caseId,
    variantId: variant.variantId,
    status: variant.status,
    time: {
      startedAt: variant.startedAt,
      endedAt: variant.endedAt,
      durationMs: durationMs(variant.startedAt, variant.endedAt),
      planDurationMs: durationMs(planPhase?.startedAt, planPhase?.endedAt),
      implementationDurationMs: durationMs(implPhase?.startedAt, implPhase?.endedAt),
      activeAgentDurationMs: sumDurations(variant.phases.map((phase) => phase.agentDurationMs)),
      planActiveAgentDurationMs: planPhase?.agentDurationMs,
      implementationActiveAgentDurationMs: implPhase?.agentDurationMs
    },
    tokens: tokenStats,
    tools: toolStats,
    files: {
      ...fileStats,
      changed,
      confidence: fileStats.confidence
    },
    commands: commandStats,
    git: {
      baseCommit: variant.baseCommit,
      contextCommit: variant.contextCommit || variant.baseCommit,
      planCommit: variant.planCommit,
      implementationCommit,
      branch: variant.branch,
      worktree: variant.worktree,
      diffStat: stat
    },
    conversations,
    warnings: [...new Set([...(scan?.warnings || []).map((warning) => warning.message), ...variant.warnings])]
  };
  return metrics;
}

/** Returns whether a usage event falls within the variant's time window and worktree path. */
function eventInVariant(event: UsageJsonlLineV1, worktreeAliases: string[], since: string, until: string): boolean {
  const observed = event.observed_at || event.recorded_at;
  if (observed < since || observed > until) return false;
  const cwd = event.repo.cwd || "";
  const root = event.repo.root || "";
  return isInsideAny(worktreeAliases, cwd) || isInsideAny(worktreeAliases, root);
}

/** Deduplicates usage events by provider+conversation id and returns a flat list. */
function uniqueConversations(events: UsageJsonlLineV1[]): EvalMetrics["conversations"] {
  const seen = new Set<string>();
  const rows: EvalMetrics["conversations"] = [];
  for (const event of events) {
    const key = `${event.provider}:${event.conversation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ provider: event.provider, id: event.conversation.id });
  }
  return rows;
}

/** Aggregates tool-call events into per-model, per-name, and per-category counts. */
function toolMetrics(events: UsageJsonlLineV1[]): EvalMetrics["tools"] {
  const calls = events.filter((event) => event.kind === "tool.call");
  const byModel: Record<string, number> = {};
  const byName: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const callRows: EvalMetrics["tools"]["calls"] = [];
  for (const call of calls) {
    const name = stringField(call.data, "tool_name") || "unknown";
    const category = stringField(call.data, "category") || categorizeTool(name);
    increment(byModel, call.actor?.model || "unknown");
    increment(byName, name);
    increment(byCategory, category);
    callRows.push({
      provider: call.provider,
      conversationId: call.conversation.id,
      turnId: call.turn?.id,
      eventId: call.event_id,
      at: call.observed_at || call.recorded_at,
      model: call.actor?.model,
      toolCallId: call.links?.tool_call_id,
      name,
      category,
      targetPaths: pathsFromUnknown(call.data),
      command: commandTexts(call.data)[0]
    });
  }
  return { total: calls.length, byModel, byName, byCategory, calls: callRows };
}

/** Aggregates token-usage events into per-model totals and a flat message list. */
function tokenMetrics(events: UsageJsonlLineV1[]): EvalMetrics["tokens"] {
  const byModel = new Map<string, { model: string; input: number; output: number; cacheRead: number; cacheCreation: number; total: number; found: boolean }>();
  const messages: EvalMetrics["tokens"]["messages"] = [];
  for (const event of events) {
    const usage = usageObject(event);
    if (!usage) continue;
    const model = event.actor?.model || stringField(event.data, "model") || stringField(usage, "model") || "unknown";
    const totals = usageTotals(usage);
    const row = byModel.get(model) || { model, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, found: false };
    row.input += totals.input;
    row.output += totals.output;
    row.cacheRead += totals.cacheRead;
    row.cacheCreation += totals.cacheCreation;
    row.total += totals.total;
    row.found = true;
    byModel.set(model, row);
    messages.push({
      provider: event.provider,
      conversationId: event.conversation.id,
      turnId: event.turn?.id,
      eventId: event.event_id,
      at: event.observed_at || event.recorded_at,
      model,
      input: totals.input || undefined,
      output: totals.output || undefined,
      cacheRead: totals.cacheRead || undefined,
      cacheCreation: totals.cacheCreation || undefined,
      total: totals.total || undefined,
      confidence: usageConfidence(event),
      source: event.capture.source === "native-import" ? "native" : event.capture.source
    });
  }
  const rows = [...byModel.values()].filter((row) => row.found).map((row) => {
    const total = row.total || row.input + row.output + row.cacheRead + row.cacheCreation;
    return {
      model: row.model,
      input: row.input || undefined,
      output: row.output || undefined,
      cacheRead: row.cacheRead || undefined,
      cacheCreation: row.cacheCreation || undefined,
      total: total || undefined,
      confidence: "derived" as const
    };
  });
  return {
    total: rows.reduce((sum, row) => sum + (row.total || 0), 0) || undefined,
    byModel: rows,
    messages
  };
}

/** Extracts read, searched, and written file sets from usage events, falling back to command-text inference. */
function fileMetrics(events: UsageJsonlLineV1[]): Pick<EvalMetrics["files"], "read" | "searched" | "written" | "confidence"> {
  const read = new Set<string>();
  const searched = new Set<string>();
  const written = new Set<string>();
  let inferred = false;

  for (const event of events) {
    if (event.kind === "file.read") addAll(read, pathsFromUnknown(event.data));
    if (event.kind === "file.search") addAll(searched, pathsFromUnknown(event.data));
    if (event.kind === "file.write") addAll(written, pathsFromUnknown(event.data));
    if (event.kind !== "tool.call") continue;
    const category = stringField(event.data, "category") || "";
    const toolName = stringField(event.data, "tool_name") || "";
    const paths = pathsFromUnknown(event.data);
    if (category === "file_read" || /read/i.test(toolName)) addAll(read, paths);
    else if (category === "file_search" || /search|grep|glob|rg/i.test(toolName)) addAll(searched, paths);
    else if (category === "file_write" || /write|edit|apply_patch/i.test(toolName)) addAll(written, paths);
    else if (category === "command") {
      const command = commandTexts(event.data)[0];
      if (command) {
        inferred = true;
        const derived = pathsFromCommand(command);
        if (/\b(rg|grep|find)\b/.test(command)) addAll(searched, derived);
        if (/\b(cat|sed|awk|ls|head|tail|nl)\b/.test(command)) addAll(read, derived);
      }
    }
  }

  return {
    read: [...read].sort(),
    searched: [...searched].sort(),
    written: [...written].sort(),
    confidence: inferred ? "partial" : "derived"
  };
}

/** Counts total commands and categorises them into test, build, lint, typecheck, and failure buckets. */
function commandMetrics(events: UsageJsonlLineV1[]): EvalMetrics["commands"] {
  const commands = events.flatMap((event) => event.kind === "command.exec" || event.kind === "tool.call" || event.kind === "tool.result" ? commandTexts(event.data) : []);
  let tests = 0;
  let builds = 0;
  let lints = 0;
  let typechecks = 0;
  let failures = 0;
  for (const command of commands) {
    const lower = command.toLowerCase();
    if (/\b(test|vitest|jest|mocha|pytest|cargo test|go test)\b/.test(lower)) tests += 1;
    if (/\b(build|tsc|webpack|vite build|cargo build)\b/.test(lower)) builds += 1;
    if (/\b(lint|eslint|ruff|flake8|prettier)\b/.test(lower)) lints += 1;
    if (/\b(tsc|typecheck|mypy|pyright)\b/.test(lower)) typechecks += 1;
  }
  for (const event of events) {
    const status = stringField(event.data, "status");
    if (event.kind === "tool.result" && (status === "error" || Boolean(field(event.data, "error")))) failures += 1;
    if (event.kind === "command.exec" && (status === "error" || numberField(event.data, "exit_code"))) failures += 1;
  }
  return { total: commands.length, tests, builds, lints, typechecks, failures };
}

/** Recursively extracts file-path strings from an arbitrary event data object. */
function pathsFromUnknown(value: unknown): string[] {
  const rows: string[] = [];
  collectPathFields(value, rows);
  return [...new Set(rows.map(normalizePathLike).filter(Boolean))];
}

/** Recursively walks an object tree and appends any recognised path-field string values to rows. */
function collectPathFields(value: unknown, rows: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectPathFields(item, rows);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (["file_path", "file_paths", "path", "paths", "target_path", "target_paths", "glob"].includes(key)) {
      if (typeof nested === "string") rows.push(nested);
      else if (Array.isArray(nested)) rows.push(...nested.filter((item): item is string => typeof item === "string"));
    }
    if (key === "input" || key === "tool_input" || key === "command") collectPathFields(nested, rows);
  }
}

/** Extracts the shell command string(s) from an event data object, checking common key names. */
function commandTexts(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const command = record.command || record.cmd;
  if (typeof command === "string") return [command];
  if (command && typeof command === "object") {
    const text = (command as Record<string, unknown>).text;
    return typeof text === "string" ? [text] : [];
  }
  const input = record.input || record.tool_input;
  if (input && typeof input === "object") return commandTexts(input);
  return [];
}

/** Extracts path-like tokens from a shell command string by splitting on whitespace and filtering flags/operators. */
function pathsFromCommand(command: string): string[] {
  return command.split(/\s+/)
    .map((part) => part.replace(/^['"]|['"]$/g, ""))
    .filter((part) => Boolean(part) && !part.startsWith("-") && /[./]/.test(part) && !/[;&|]/.test(part));
}

/** Returns the value of a named key from an unknown object, or undefined if not an object. */
function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Returns a named field as a string, or undefined if absent or not a string. */
function stringField(value: unknown, key: string): string | undefined {
  const item = field(value, key);
  return typeof item === "string" ? item : undefined;
}

/** Returns a named field as a finite number, or undefined if absent or non-numeric. */
function numberField(value: unknown, key: string): number | undefined {
  const item = field(value, key);
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

/** Extracts the usage sub-object from an event, handling both nested and top-level token.usage events. */
function usageObject(event: UsageJsonlLineV1): Record<string, unknown> | undefined {
  const usage = field(event.data, "usage");
  if (usage && typeof usage === "object" && !Array.isArray(usage)) return usage as Record<string, unknown>;
  if (event.kind !== "token.usage") return undefined;
  return event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : undefined;
}

/** Normalises provider-specific token field names into a single set of totals. */
function usageTotals(usage: Record<string, unknown>): { input: number; output: number; cacheRead: number; cacheCreation: number; total: number } {
  const input = numberField(usage, "input") || numberField(usage, "input_tokens") || 0;
  const output = numberField(usage, "output") || numberField(usage, "output_tokens") || 0;
  const cacheRead =
    numberField(usage, "cacheRead") ||
    numberField(usage, "cache_read_input_tokens") ||
    numberField(usage, "cached_input_tokens") ||
    0;
  const cacheCreation = numberField(usage, "cacheCreation") || numberField(usage, "cache_creation_input_tokens") || 0;
  const total = numberField(usage, "total") || numberField(usage, "total_tokens") || input + output + cacheRead + cacheCreation;
  return { input, output, cacheRead, cacheCreation, total };
}

/** Returns the token-count confidence level for an event, preferring an explicit field over capture-source inference. */
function usageConfidence(event: UsageJsonlLineV1): EvalMetrics["tokens"]["messages"][number]["confidence"] {
  const value = stringField(event.data, "usageConfidence") || stringField(event.data, "confidence");
  if (value === "provider-reported" || value === "derived" || value === "estimated") return value;
  return event.capture.source === "native-import" ? "provider-reported" : "unknown";
}

/** Increments a counter in a string-keyed record, initialising to 0 if absent. */
function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] || 0) + 1;
}

/** Adds all strings from an array into a set. */
function addAll(set: Set<string>, rows: string[]): void {
  for (const row of rows) set.add(row);
}

/** Normalises a path-like string: trims whitespace, converts backslashes, and strips leading ./. */
function normalizePathLike(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

/** Returns the millisecond delta between two ISO timestamps, or undefined if either is absent or unparseable. */
function durationMs(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended)) return undefined;
  return Math.max(0, ended - started);
}

/** Sums an array of optional millisecond durations, returning undefined when none are present. */
function sumDurations(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  if (!present.length) return undefined;
  return present.reduce((sum, value) => sum + value, 0);
}

/** Returns both the resolved and real (symlink-followed) forms of a path to handle worktree alias matching. */
async function pathAliases(filePath: string): Promise<string[]> {
  const resolved = path.resolve(filePath);
  const canonical = await realpath(filePath).catch(() => resolved);
  return [...new Set([resolved, canonical])];
}

/** Returns true when target is inside any of the base paths. */
function isInsideAny(bases: string[], target: string): boolean {
  return bases.some((base) => isInside(base, target));
}

/** Returns true when target is the same as base or a descendant of it. */
function isInside(base: string, target: string): boolean {
  if (!target) return false;
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Maps a tool name to a broad category string using regex pattern matching. */
function categorizeTool(toolName: string): string {
  if (/bash|shell|exec/i.test(toolName)) return "command";
  if (/apply_patch|edit|write/i.test(toolName)) return "file_write";
  if (/read/i.test(toolName)) return "file_read";
  if (/search|grep|glob|rg/i.test(toolName)) return "file_search";
  if (/mcp/i.test(toolName)) return "mcp";
  if (/web/i.test(toolName)) return "web";
  return "other";
}
