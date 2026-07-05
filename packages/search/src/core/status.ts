import type { SearchConfig } from "../types/config.js";
import { statusDb, type SearchStatus } from "./search.js";

/** Reports. */
export function status(options: { dbPath: string; config: SearchConfig; repoRoot: string }): SearchStatus & { configuredLanguages: string[]; repoRoot: string } {
  return {
    ...statusDb(options.dbPath),
    configuredLanguages: options.config.indexing.languages,
    repoRoot: options.repoRoot
  };
}
