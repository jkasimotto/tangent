import type { SummaryProviderConfig } from "./provider.js";

export type DailyOutputMode = "user-global" | "repo-local-private";
export type DateBucketMode = "endedAt" | "startedAt" | "lastActivityAt";
export type WorkSessionGrouping = "conversation" | "idle-gap" | "branch-and-paths";
export type DailyNoteSection =
  | "standup"
  | "daySummary"
  | "workSessions"
  | "decisions"
  | "experiments"
  | "designSeeds"
  | "followUps"
  | "risks"
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
    workSessionIdleGapMinutes: number;
    reprocessWhenConversationChanges: boolean;
    grouping: WorkSessionGrouping;
  };
  input: {
    providers: Array<"claude" | "codex">;
    includeVisibleMessages: boolean;
    includeInternalMessages: boolean;
    includeToolInputs: boolean;
    includeToolResults: boolean;
    includeFilePaths: boolean;
    includeTokenUsage: boolean;
    maxConversationChars: number;
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
    sessionDigestSchemaVersion: "session-digest.v1";
    dailyNoteSchemaVersion: "daily-note.v1";
    writeDigestCache: boolean;
  };
  note: {
    titleTemplate: string;
    sections: DailyNoteSection[];
    includeStandupSnippet: boolean;
    includeDesignSeeds: boolean;
    includeFollowUps: boolean;
    includeMetrics: boolean;
  };
};
