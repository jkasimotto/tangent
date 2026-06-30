import type { SummaryProviderConfig } from "./provider.js";

export type RollupOutputMode = "user-global" | "repo-local-private";
export type DateBucketMode = "turnEndedAt" | "turnStartedAt" | "lastActivityAt";

export type RollupConfig = {
  schema: "rollup.config.v1";
  repo?: {
    root?: string;
    displayName?: string;
  };
  output: {
    mode: RollupOutputMode;
    baseDir?: string;
    notesDir?: string;
    artifactsDir?: string;
  };
  processing: {
    timezone: string;
    dateBucket: DateBucketMode;
    reprocessWhenConversationChanges: boolean;
    maxTurnDurationMinutesForRollup: number;
  };
  input: {
    providers: Array<"claude" | "codex" | "gemini">;
    includeVisibleMessages: boolean;
    includeInternalMessages: boolean;
    includeToolInputs: boolean;
    includeToolResults: boolean;
    includeFilePaths: boolean;
    includeTokenUsage: boolean;
    maxUserMessageChars: number;
    maxTurnInputChars: number;
    maxToolResultChars: number;
  };
  privacy: {
    redactSecrets: boolean;
    contentMode: "metadata-only" | "metadata-with-excerpts" | "full";
    maxQuoteChars: number;
    excludePathGlobs: string[];
  };
  examples: {
    enabled: boolean;
    maxExamples: number;
    includePreviousNotes: boolean;
  };
  summary: {
    provider: SummaryProviderConfig;
  };
  note: {
    titleTemplate: string;
  };
};
