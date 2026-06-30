import { readFile } from "node:fs/promises";
import path from "node:path";

import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalCaseSpec, EvalPhaseId, EvalPhaseSpec, EvalRepoSpec, EvalSpec, ResolvedEvalVariant } from "../types/spec.js";
import type { EvalContextMode } from "../types/context.js";
import { resolveMaybeRelative } from "./paths.js";

export type LoadedEvalSpec = {
  spec: EvalSpec;
  specPath?: string;
  specDir: string;
  invocationCwd: string;
  variants: ResolvedEvalVariant[];
};

/** Loads and validates an eval spec from disk. */
export async function loadEvalSpec(specPath: string, options: { invocationCwd?: string } = {}): Promise<LoadedEvalSpec> {
  const invocationCwd = options.invocationCwd || process.cwd();
  const absolutePath = resolveMaybeRelative(invocationCwd, specPath);
  const specDir = path.dirname(absolutePath);
  const spec = JSON.parse(await readFile(absolutePath, "utf8")) as EvalSpec;
  validateSpec(spec);
  return {
    spec,
    specPath: absolutePath,
    specDir,
    invocationCwd,
    variants: await resolveVariants(spec, { specDir, invocationCwd })
  };
}

/** Expands eval cases and variants into prepared run inputs. */
export async function resolveVariants(spec: EvalSpec, options: { specDir: string; invocationCwd: string }): Promise<ResolvedEvalVariant[]> {
  const rows: ResolvedEvalVariant[] = [];
  for (const testCase of spec.cases) {
    for (const variant of testCase.variants) {
      const repo = mergeRequiredRepo(variant.repo, testCase, spec.defaults?.repo);
      const cwd = variant.cwd || testCase.cwd || spec.defaults?.cwd || ".";
      const agent = variant.agent || spec.defaults?.agent || { kind: "manual" as const };
      const phases = normalizePhases(variant.phases || testCase.phases || spec.defaults?.phases || ["implement"]);
      const prompt = variant.prompt || testCase.prompt;
      if (!prompt) throw new Error(`Eval case ${testCase.id} variant ${variant.id} requires prompt on variant or case.`);
      const promptPath = resolveMaybeRelative(options.specDir, prompt);
      rows.push({
        caseId: testCase.id,
        variantId: variant.id,
        promptPath,
        prompt: await readFile(promptPath, "utf8"),
        repo,
        cwd,
        context: variant.context || { mode: "repo" },
        agent,
        phases
      });
    }
  }
  return rows;
}

/** Normalizes phase shorthand into explicit phase config. */
export function normalizePhases(phases: EvalPhaseSpec[]): ResolvedEvalVariant["phases"] {
  return phases.map((phase) => {
    const id = typeof phase === "string" ? phase : phase.id;
    if (id !== "plan" && id !== "implement") throw new Error(`Unknown eval phase: ${id}`);
    const mode = typeof phase === "string"
      ? id === "plan" ? "read-only" : "workspace-write"
      : phase.mode || (id === "plan" ? "read-only" : "workspace-write");
    return {
      id,
      mode,
      commit: typeof phase === "string" ? true : phase.commit !== false
    };
  });
}

/** Normalizes partial agent config into a concrete provider config. */
export function normalizeAgent(value: Partial<EvalAgentConfig> | undefined): EvalAgentConfig {
  if (!value || !("kind" in value) || !value.kind || value.kind === "manual") return { kind: "manual" };
  if (value.kind === "codex-cli") {
    return {
      kind: "codex-cli",
      command: value.command,
      model: value.model || "gpt-5.4",
      profile: value.profile,
      sandbox: value.sandbox || "workspace-write",
      timeoutMs: value.timeoutMs,
      env: value.env
    };
  }
  if (value.kind === "claude-cli") {
    return {
      kind: "claude-cli",
      command: value.command,
      model: value.model || "sonnet",
      permissionMode: value.permissionMode,
      maxTurns: value.maxTurns,
      timeoutMs: value.timeoutMs,
      env: value.env
    };
  }
  if (value.kind === "gemini-cli") {
    return {
      kind: "gemini-cli",
      command: value.command,
      model: value.model || "gemini-2.0-flash",
      timeoutMs: value.timeoutMs,
      env: value.env
    };
  }
  throw new Error(`Unknown agent kind: ${(value as { kind?: string }).kind}`);
}

/** Parses a CLI context value into an eval context mode. */
export function parseContextValue(value: string): EvalContextMode {
  if (value === "repo") return { mode: "repo" };
  if (value === "empty" || value === "no-context") return { mode: "empty" };
  if (value.startsWith("git-ref:")) return { mode: "git-ref", ref: value.slice("git-ref:".length) };
  if (value.startsWith("snapshot:")) return { mode: "snapshot", ref: normalizeContextRef(value.slice("snapshot:".length)) };
  return { mode: "snapshot", ref: normalizeContextRef(value) };
}

/** Normalizes a short context id into the tangent refs namespace. */
export function normalizeContextRef(value: string): string {
  if (value.startsWith("refs/")) return value;
  return `refs/tangent/eval/contexts/${value}`;
}

/** A criterion's resolved point value (default 1). Binary scoring: this is awarded in full or not at all. */
export function resolveCriterionPoints(points: number | undefined): number {
  return points ?? 1;
}

/** Validates required eval spec fields and variant prompts. */
function validateSpec(spec: EvalSpec): void {
  if (spec.schema !== "eval.spec.v1") throw new Error("Eval spec schema must be eval.spec.v1.");
  if (!spec.name) throw new Error("Eval spec requires a name.");
  if (!Array.isArray(spec.cases) || spec.cases.length === 0) throw new Error("Eval spec requires at least one case.");
  for (const testCase of spec.cases) {
    if (!testCase.id) throw new Error("Eval case requires id.");
    if (!Array.isArray(testCase.variants) || testCase.variants.length === 0) throw new Error(`Eval case ${testCase.id} requires variants.`);
    for (const variant of testCase.variants) {
      if (!variant.id) throw new Error(`Eval case ${testCase.id} has variant without id.`);
      if (!variant.prompt && !testCase.prompt) throw new Error(`Eval case ${testCase.id} variant ${variant.id} requires prompt on variant or case.`);
    }
  }
  if (spec.evaluator) {
    const { model, criteria } = spec.evaluator;
    if (!model) throw new Error("Eval evaluator requires a model.");
    if (!Array.isArray(criteria) || criteria.length === 0) throw new Error("Eval evaluator criteria must be a non-empty array.");
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
}

/** Resolves the required repository config for a variant. */
function mergeRequiredRepo(variantRepo: EvalRepoSpec | undefined, testCase: EvalCaseSpec, defaultRepo: EvalRepoSpec | undefined): EvalRepoSpec {
  const repo = variantRepo || defaultRepo;
  if (!repo) throw new Error(`Eval case ${testCase.id} requires repo on variant or defaults.`);
  return {
    path: repo.path || ".",
    ref: repo.ref || "HEAD"
  };
}
