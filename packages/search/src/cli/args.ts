import { booleanArg, numberArg, parseArgs, stringArg, type Args } from "@tangent/core/cli";
import type { LanguageId } from "../languages/base.js";
import type { SearchMode, SearchStorageMode } from "../types/config.js";

export { booleanArg, numberArg, parseArgs, stringArg, type Args };

/** Supports the language args helper. */
export function languageArgs(value: unknown): LanguageId[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("--language must be dart, typescript, javascript, ts, js, or all.");
  if (value === "all") return ["dart", "typescript"];
  return value.split(",").map((item) => {
    const language = item.trim();
    if (language === "dart") return "dart";
    if (language === "typescript" || language === "javascript" || language === "ts" || language === "js") return "typescript";
    throw new Error("--language must be dart, typescript, javascript, ts, js, or all.");
  });
}

/** Supports the mode arg helper. */
export function modeArg(value: unknown): SearchMode | undefined {
  if (value === undefined) return undefined;
  if (value === "precise" || value === "normal" || value === "broad") return value;
  throw new Error("--mode must be precise, normal, or broad.");
}

/** Supports the storage arg helper. */
export function storageArg(value: unknown): SearchStorageMode | undefined {
  if (value === undefined) return undefined;
  if (value === "user-global" || value === "repo-local-private") return value;
  throw new Error("--storage must be user-global or repo-local-private.");
}

/** Supports the scope arg helper. */
export function scopeArg(value: unknown): "private" | "global" | "repo-shared" | undefined {
  if (value === undefined) return undefined;
  if (value === "private" || value === "global" || value === "repo-shared") return value;
  throw new Error("--scope must be private, global, or repo-shared.");
}
