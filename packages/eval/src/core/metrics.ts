import { writeFile } from "node:fs/promises";
import path from "node:path";
import { changedFiles, currentCommit, diffStat, statusPorcelain } from "@tangent/repo/git";
import { commitAll } from "@tangent/repo/worktree";

import { scanRepo, type UsageJsonlLineV1 } from "@tangent/usage";

import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { loadRunManifest, saveRunManifest } from "./run-store.js";

export async function collectEval(idOrManifest: string | EvalRunManifest): Promise<{ manifest: EvalRunManifest; metrics: EvalMetrics[] }> {
  const manifest = typeof idOrManifest === "string" ? await loadRunManifest(idOrManifest) : idOrManifest;
  const rows: EvalMetrics[] = [];
  for (const variant of manifest.variants) {
    await captureManualTail(variant);
    const metrics = await collectVariantMetrics(manifest, variant);
    await writeFile(variant.metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
    rows.push(metrics);
  }
  await writeFile(path.join(manifest.runDir, "report.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await saveRunManifest(manifest);
  return { manifest, metrics: rows };
}

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

async function collectVariantMetrics(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalMetrics> {
  const since = variant.startedAt || manifest.createdAt;
  const until = variant.endedAt || new Date().toISOString();
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

  const events = (scan?.events || []).filter((event) => eventInVariant(event, variant, since, until));
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
      implementationDurationMs: durationMs(implPhase?.startedAt, implPhase?.endedAt)
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

function eventInVariant(event: UsageJsonlLineV1, variant: EvalRunVariantState, since: string, until: string): boolean {
  const observed = event.observed_at || event.recorded_at;
  if (observed < since || observed > until) return false;
  const cwd = event.repo.cwd || "";
  const root = event.repo.root || "";
  return isInside(variant.worktree, cwd) || isInside(variant.worktree, root);
}

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

function toolMetrics(events: UsageJsonlLineV1[]): EvalMetrics["tools"] {
  const calls = events.filter((event) => event.kind === "tool.call");
  const byModel: Record<string, number> = {};
  const byName: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const call of calls) {
    increment(byModel, call.actor?.model || "unknown");
    increment(byName, stringField(call.data, "tool_name") || "unknown");
    increment(byCategory, stringField(call.data, "category") || categorizeTool(stringField(call.data, "tool_name") || "unknown"));
  }
  return { total: calls.length, byModel, byName, byCategory };
}

function tokenMetrics(events: UsageJsonlLineV1[]): EvalMetrics["tokens"] {
  const byModel = new Map<string, { model: string; input: number; output: number; cacheRead: number; total: number; found: boolean }>();
  for (const event of events) {
    for (const usage of collectUsageObjects(event.data)) {
      const model = event.actor?.model || stringField(usage, "model") || "unknown";
      const row = byModel.get(model) || { model, input: 0, output: 0, cacheRead: 0, total: 0, found: false };
      row.input += numberField(usage, "input") || numberField(usage, "input_tokens") || 0;
      row.output += numberField(usage, "output") || numberField(usage, "output_tokens") || 0;
      row.cacheRead += numberField(usage, "cacheRead") || numberField(usage, "cache_read_input_tokens") || 0;
      row.total += numberField(usage, "total") || numberField(usage, "total_tokens") || 0;
      row.found = true;
      byModel.set(model, row);
    }
  }
  const rows = [...byModel.values()].filter((row) => row.found).map((row) => {
    const total = row.total || row.input + row.output + row.cacheRead;
    return {
      model: row.model,
      input: row.input || undefined,
      output: row.output || undefined,
      cacheRead: row.cacheRead || undefined,
      total: total || undefined,
      confidence: "derived" as const
    };
  });
  return {
    total: rows.reduce((sum, row) => sum + (row.total || 0), 0) || undefined,
    byModel: rows
  };
}

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

function pathsFromUnknown(value: unknown): string[] {
  const rows: string[] = [];
  collectPathFields(value, rows);
  return [...new Set(rows.map(normalizePathLike).filter(Boolean))];
}

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

function pathsFromCommand(command: string): string[] {
  return command.split(/\s+/)
    .map((part) => part.replace(/^['"]|['"]$/g, ""))
    .filter((part) => Boolean(part) && !part.startsWith("-") && /[./]/.test(part) && !/[;&|]/.test(part));
}

function collectUsageObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectUsageObjects);
  const record = value as Record<string, unknown>;
  const direct = "usage" in record ? collectUsageObjects(record.usage) : [];
  const isUsage = Object.keys(record).some((key) => key.includes("token") || key === "input" || key === "output" || key === "total");
  return isUsage ? [record, ...direct] : [...direct, ...Object.values(record).flatMap(collectUsageObjects)];
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const item = field(value, key);
  return typeof item === "string" ? item : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const item = field(value, key);
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] || 0) + 1;
}

function addAll(set: Set<string>, rows: string[]): void {
  for (const row of rows) set.add(row);
}

function normalizePathLike(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function durationMs(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended)) return undefined;
  return Math.max(0, ended - started);
}

function isInside(base: string, target: string): boolean {
  if (!target) return false;
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function categorizeTool(toolName: string): string {
  if (/bash|shell|exec/i.test(toolName)) return "command";
  if (/apply_patch|edit|write/i.test(toolName)) return "file_write";
  if (/read/i.test(toolName)) return "file_read";
  if (/search|grep|glob|rg/i.test(toolName)) return "file_search";
  if (/mcp/i.test(toolName)) return "mcp";
  if (/web/i.test(toolName)) return "web";
  return "other";
}
