import { homedir } from "node:os";
import path from "node:path";

export function evalHome(): string {
  return process.env.TANGENT_EVAL_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "eval");
}

export function runsDir(): string {
  return path.join(evalHome(), "runs");
}

export function contextsDir(): string {
  return path.join(evalHome(), "contexts");
}

export function promptsDir(): string {
  return path.join(evalHome(), "prompts");
}

export function runDir(runId: string): string {
  return path.join(runsDir(), runId);
}

export function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "eval";
}

export function contextRef(nameOrRef: string): string {
  if (nameOrRef.startsWith("refs/")) return nameOrRef;
  return `refs/tangent/eval/contexts/${sanitizePathSegment(nameOrRef)}`;
}

export function isoCompact(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function relativeFrom(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
}

export function resolveMaybeRelative(base: string, value: string): string {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(base, value);
}
