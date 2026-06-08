import type { LanguageId } from "../languages/base.js";
import type { SearchMode, SearchStorageMode } from "../types/config.js";

export type Args = {
  _: string[];
  [key: string]: string | boolean | string[];
};

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey!;
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberArg(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) throw new Error(`Expected number, got ${String(value)}.`);
  return Number(value);
}

export function booleanArg(value: unknown): boolean {
  return value === true || value === "true";
}

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

export function modeArg(value: unknown): SearchMode | undefined {
  if (value === undefined) return undefined;
  if (value === "precise" || value === "normal" || value === "broad") return value;
  throw new Error("--mode must be precise, normal, or broad.");
}

export function storageArg(value: unknown): SearchStorageMode | undefined {
  if (value === undefined) return undefined;
  if (value === "user-global" || value === "repo-local-private") return value;
  throw new Error("--storage must be user-global or repo-local-private.");
}

export function scopeArg(value: unknown): "private" | "global" | "repo-shared" | undefined {
  if (value === undefined) return undefined;
  if (value === "private" || value === "global" || value === "repo-shared") return value;
  throw new Error("--scope must be private, global, or repo-shared.");
}
