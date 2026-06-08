import type { SummaryProviderConfig } from "./provider.js";

export type DailyOutputMode = "user-global" | "repo-local-private";
export type DateBucketMode = "turnEndedAt" | "turnStartedAt" | "lastActivityAt";
export type DailyNoteSection =
  | "topics"
  | "metrics"
  | "sourceCaveats";

export type DailyConfig = {
  schema: "daily.config.v1";
  repo?: {
    root?: string;
    displayName?: string;
  };
  output: {
    mode: DailyOutputMode;
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
    maxTurnDurationMinutesForDaily: number;
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
  summary: {
    provider: SummaryProviderConfig;
    turnDigestSchemaVersion: "turn-digest.v1";
    topicRollupSchemaVersion: "topic-rollup.v1";
    dailyNoteSchemaVersion: "daily-note.v2";
    writeDigestCache: boolean;
  };
  note: {
    titleTemplate: string;
    sections: DailyNoteSection[];
    includeFollowUps: boolean;
    includeMetrics: boolean;
  };
};
