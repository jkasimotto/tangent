import type { SummaryProviderConfig } from "./provider.js";

export type RollupOutputMode = "user-global" | "repo-local-private";
export type DateBucketMode = "turnEndedAt" | "turnStartedAt" | "lastActivityAt";
export type RollupNoteSection =
  | "topics"
  | "metrics"
  | "sourceCaveats";

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
    includeActiveConversations: boolean;
    activeQuietMinutes: number;
    reprocessWhenConversationChanges: boolean;
    maxTurnDurationMinutesForRollup: number;
  };
  input: {
    providers: Array<"claude" | "codex">;
    includeVisibleMessages: boolean;
    includeInternalMessages: boolean;
    includeToolInputs: boolean;
    includeToolResults: boolean;
    includeFilePaths: boolean;
    includeTokenUsage: boolean;
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
    turnDigestSchemaVersion: "turn-digest.v1";
    topicRollupSchemaVersion: "topic-rollup.v1";
    rollupNoteSchemaVersion: "rollup-note.v1";
    writeDigestCache: boolean;
  };
  note: {
    titleTemplate: string;
    sections: RollupNoteSection[];
    includeFollowUps: boolean;
    includeMetrics: boolean;
  };
};
