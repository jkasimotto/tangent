import type { Args } from "../args.js";
import { numberArg, stringArg, stringsArg } from "../args.js";
import { normalizeAgent, normalizePhases, parseContextValue } from "../../core/config.js";
import { listRuns } from "../../core/run-store.js";
import type { EvalAgentConfig } from "../../types/provider.js";
import type { EvalContextMode } from "../../types/context.js";
import type { EvalPhaseSpec, EvalVariantSpec } from "../../types/spec.js";

/** Builds an EvalAgentConfig from CLI args, defaulting to manual when --agent is omitted. */
export function agentFromArgs(args: Args): EvalAgentConfig {
  const kind = stringArg(args.agent) || "manual";
  if (kind === "manual") return { kind: "manual" };
  if (kind === "codex-cli") {
    return normalizeAgent({
      kind,
      command: stringArg(args.command),
      model: stringArg(args.model) || "gpt-5.4",
      profile: stringArg(args.profile),
      sandbox: sandboxArg(args.sandbox) || "workspace-write",
      timeoutMs: numberArg(args["timeout-ms"])
    });
  }
  if (kind === "claude-cli") {
    return normalizeAgent({
      kind,
      command: stringArg(args.command),
      model: stringArg(args.model) || "sonnet",
      permissionMode: stringArg(args["permission-mode"]),
      timeoutMs: numberArg(args["timeout-ms"])
    });
  }
  if (kind === "gemini-cli") {
    return normalizeAgent({
      kind,
      command: stringArg(args.command),
      model: stringArg(args.model) || "gemini-2.0-flash",
      timeoutMs: numberArg(args["timeout-ms"])
    });
  }
  throw new Error("--agent must be manual, codex-cli, claude-cli, or gemini-cli.");
}

/** Parses a comma-separated --phases string into an EvalPhaseSpec array, defaulting to plan+implement. */
export function phasesFromArgs(value: unknown): EvalPhaseSpec[] {
  const raw = stringArg(value);
  if (!raw) return ["plan", "implement"];
  return raw.split(",").map((phase) => {
    const id = phase.trim();
    if (id !== "plan" && id !== "implement") throw new Error(`Unknown phase: ${id}`);
    return id;
  });
}

/** Parses --phases and expands each phase id into its full ResolvedEvalVariant phase shape. */
export function normalizedPhaseIds(value: unknown): ReturnType<typeof normalizePhases> {
  return normalizePhases(phasesFromArgs(value));
}

/** Builds variant specs from either --variant flags or a single --context flag with an auto-derived id. */
export function variantsFromArgs(args: Args): EvalVariantSpec[] {
  const variants = stringsArg(args.variant);
  if (variants.length === 0) {
    const context = stringArg(args.context);
    return [{
      id: context ? variantIdFromContext(context) : "repo-context",
      context: context ? parseContextValue(context) : { mode: "repo" }
    }];
  }
  return variants.map(parseVariant);
}

/** Collects all --context values into EvalContextMode objects, defaulting to repo mode. */
export function contextsFromArgs(args: Args): EvalContextMode[] {
  const contexts = stringsArg(args.context);
  return contexts.length > 0 ? contexts.map(parseContextValue) : [{ mode: "repo" }];
}

/** Derives a short variant id from a context string, e.g. "repo" -> "repo-context". */
export function variantIdFromContext(value: string): string {
  if (value === "empty" || value === "no-context") return "no-context";
  if (value === "repo") return "repo-context";
  return value.split("/").at(-1)?.replace(/^contexts-/, "") || "context";
}

/** Resolves "latest" to the most recent run id, or passes through a literal run id unchanged. */
export async function resolveRunId(value: string): Promise<string> {
  if (value !== "latest") return value;
  const latest = (await listRuns())[0];
  if (!latest) throw new Error("No eval runs found.");
  return latest.id;
}

/** Parses a --variant flag value in "id:mode[:ref]" format into an EvalVariantSpec. */
function parseVariant(value: string): EvalVariantSpec {
  const parts = value.split(":");
  const id = parts.shift();
  if (!id) throw new Error(`Invalid --variant: ${value}`);
  const mode = parts.shift() || "repo";
  if (mode === "repo") return { id, context: { mode: "repo" } };
  if (mode === "empty" || mode === "no-context") return { id, context: { mode: "empty" } };
  if (mode === "snapshot") {
    const ref = parts.join(":");
    if (!ref) throw new Error(`Snapshot variant requires ref: ${value}`);
    return { id, context: parseContextValue(`snapshot:${ref}`) };
  }
  if (mode === "git-ref") {
    const ref = parts.join(":");
    if (!ref) throw new Error(`git-ref variant requires ref: ${value}`);
    return { id, context: { mode: "git-ref", ref } };
  }
  return { id, context: parseContextValue(mode) };
}

/** Validates and narrows --sandbox to its three allowed string literals. */
function sandboxArg(value: unknown): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  const raw = stringArg(value);
  if (!raw) return undefined;
  if (raw === "read-only" || raw === "workspace-write" || raw === "danger-full-access") return raw;
  throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access.");
}
