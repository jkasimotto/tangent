import { homedir } from "node:os";
import path from "node:path";

export function resolveUserPath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return path.join(homedir(), inputPath.slice(2));
  return path.resolve(inputPath);
}

export function sanitizePathSegment(value: string, fallback = "item"): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function relativeFrom(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
}

export function resolveMaybeRelative(base: string, value: string): string {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(base, value);
}
