import type { Args } from "../args.js";
import { numberArg, stringArg, stringsArg } from "../args.js";
import { normalizeAgent, normalizePhases, parseContextValue } from "../../core/config.js";
import type { EvalAgentConfig } from "../../types/provider.js";
import type { EvalContextMode } from "../../types/context.js";
import type { EvalPhaseSpec, EvalVariantSpec } from "../../types/spec.js";

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
  throw new Error("--agent must be manual, codex-cli, or claude-cli.");
}

export function phasesFromArgs(value: unknown): EvalPhaseSpec[] {
  const raw = stringArg(value);
  if (!raw) return ["plan", "implement"];
  return raw.split(",").map((phase) => {
    const id = phase.trim();
    if (id !== "plan" && id !== "implement") throw new Error(`Unknown phase: ${id}`);
    return id;
  });
}

export function normalizedPhaseIds(value: unknown): ReturnType<typeof normalizePhases> {
  return normalizePhases(phasesFromArgs(value));
}

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

export function contextsFromArgs(args: Args): EvalContextMode[] {
  const contexts = stringsArg(args.context);
  return contexts.length > 0 ? contexts.map(parseContextValue) : [{ mode: "repo" }];
}

export function variantIdFromContext(value: string): string {
  if (value === "empty" || value === "no-context") return "no-context";
  if (value === "repo") return "repo-context";
  return value.split("/").at(-1)?.replace(/^contexts-/, "") || "context";
}

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

function sandboxArg(value: unknown): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  const raw = stringArg(value);
  if (!raw) return undefined;
  if (raw === "read-only" || raw === "workspace-write" || raw === "danger-full-access") return raw;
  throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access.");
}
