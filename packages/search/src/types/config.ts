import type { LanguageId } from "../languages/base.js";

export type SearchStorageMode = "user-global" | "repo-local-private";
export type SearchMode = "precise" | "normal" | "broad";

export type SearchConfig = {
  schema: "search.config.v1";
  repo?: {
    root?: string;
    displayName?: string;
  };
  storage: {
    mode: SearchStorageMode;
    baseDir?: string;
    dbPath?: string;
  };
  indexing: {
    languages: LanguageId[];
    includeGenerated: boolean;
    includeGlobs: string[];
    excludeGlobs: string[];
  };
  search: {
    defaultMode: SearchMode;
    maxResults: number;
    includeTests: boolean;
  };
};
