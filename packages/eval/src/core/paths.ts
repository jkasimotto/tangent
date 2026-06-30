import { homedir } from "node:os";
import path from "node:path";

/** Returns the eval home directory, defaulting to ~/.tangent/eval. */
export function evalHome(): string {
  return process.env.TANGENT_EVAL_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "eval");
}

/** Returns the directory where all eval runs are stored. */
export function runsDir(): string {
  return path.join(evalHome(), "runs");
}

/** Returns the directory where eval context snapshots are stored. */
export function contextsDir(): string {
  return path.join(evalHome(), "contexts");
}

/** Returns the directory where eval prompt caches are stored. */
export function promptsDir(): string {
  return path.join(evalHome(), "prompts");
}

/** Returns the directory for a specific eval run by id. */
export function runDir(runId: string): string {
  return path.join(runsDir(), runId);
}

/** Lowercases and replaces non-alphanumeric characters to produce a safe path segment. */
export function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "eval";
}

/** Returns the fully-qualified git ref for a named context snapshot. */
export function contextRef(nameOrRef: string): string {
  if (nameOrRef.startsWith("refs/")) return nameOrRef;
  return `refs/tangent/eval/contexts/${sanitizePathSegment(nameOrRef)}`;
}

/** Formats a Date as a compact ISO string with separators removed, e.g. 20240101T120000Z. */
export function isoCompact(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Returns the POSIX-style relative path from base to target. */
export function relativeFrom(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
}

/** Resolves value against base if relative, otherwise normalizes the absolute path. */
export function resolveMaybeRelative(base: string, value: string): string {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(base, value);
}
