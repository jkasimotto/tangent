export type RollupSourceQuery = {
  repo?: string;
  provider?: string;
  from?: string;
  to?: string;
};

export type RollupSourceListView = {
  sources: Array<{ id: string; title: string; provider?: string; sessions?: number; messages?: number; tokens?: number }>;
  caveats: string[];
};

export type RollupSelectionQuery = {
  sourceIds: string[];
  role?: string[];
  minTokens?: number;
  maxTokens?: number;
  includeRegex?: string;
  excludeRegex?: string;
};

export type RollupSelectionPreviewView = {
  includedCount: number;
  excludedCount: number;
  tokensIncluded: number;
  tokensExcluded: number;
  longestExcludedMessage?: { id: string; preview: string; tokens?: number };
  coverageByRole: Record<string, number>;
  coverageBySession: Record<string, number>;
  caveats: string[];
  messages: Array<{
    id: string;
    include: boolean;
    role: string;
    time?: string;
    session?: string;
    chars?: number;
    tokens?: number;
    toolCount?: number;
    confidence?: string;
    preview?: string;
    reason?: string;
  }>;
};

export type CreateRollupInput = {
  selection: RollupSelectionQuery;
  format?: "markdown" | "json" | "prompt-bundle";
};

export type RollupView = {
  id: string;
  markdown?: string;
  json?: unknown;
  caveats: string[];
};

export type RollupExportView = {
  id: string;
  format: "markdown" | "json" | "prompt-bundle";
  content: string;
};

export interface RollupUiClient {
  listSources(query: RollupSourceQuery): Promise<RollupSourceListView>;
  previewSelection(query: RollupSelectionQuery): Promise<RollupSelectionPreviewView>;
  createRollup(input: CreateRollupInput): Promise<RollupView>;
  exportRollup(id: string, format: "markdown" | "json" | "prompt-bundle"): Promise<RollupExportView>;
}

/** Supports the empty rollup preview helper. */
export function emptyRollupPreview(): RollupSelectionPreviewView {
  return {
    includedCount: 0,
    excludedCount: 0,
    tokensIncluded: 0,
    tokensExcluded: 0,
    coverageByRole: {},
    coverageBySession: {},
    caveats: [],
    messages: []
  };
}
