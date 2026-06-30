import { homedir } from "node:os";
import path from "node:path";

/** Resolves a path that may use a leading ~ to the user's home directory. */
export function resolveUserPath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return path.join(homedir(), inputPath.slice(2));
  return path.resolve(inputPath);
}

/** Converts a string to a safe path segment by lowercasing and replacing unsafe characters with hyphens. */
export function sanitizePathSegment(value: string, fallback = "item"): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

/** Returns the POSIX-style relative path from base to target. */
export function relativeFrom(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
}

/** Resolves value as an absolute path if it is absolute, otherwise resolves it relative to base. */
export function resolveMaybeRelative(base: string, value: string): string {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(base, value);
}
