import type { LanguageAdapter } from "./base.js";
import { DartAdapter } from "./dart.js";
import { TypeScriptAdapter } from "./typescript.js";

const dart = new DartAdapter();
const typescript = new TypeScriptAdapter();
const adapters: Record<string, LanguageAdapter> = {
  dart,
  typescript,
  ts: typescript,
  javascript: typescript,
  js: typescript
};

/** Returns adapters. */
export function getAdapters(names?: readonly string[]): LanguageAdapter[] {
  if (!names?.length || names.map((name) => name.toLowerCase()).includes("all")) return [dart, typescript];
  const out: LanguageAdapter[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const adapter = adapters[name.toLowerCase()];
    if (!adapter) throw new Error(`unknown language ${JSON.stringify(name)}. Available: dart, typescript, all`);
    if (!seen.has(adapter.id)) {
      seen.add(adapter.id);
      out.push(adapter);
    }
  }
  return out;
}

export type { LanguageAdapter, LanguageContext, LanguageId, ParsedFile, ParsedImport, ParsedSymbol } from "./base.js";
