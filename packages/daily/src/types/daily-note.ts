import type { SessionDigest } from "./digest.js";

export type WorkSessionRollup = {
  title: string;
  summary: string;
  themes: string[];
};

export type WorkSession = {
  id: string;
  repoId: string;
  date: string;
  startedAt?: string;
  endedAt?: string;
  conversationIds: string[];
  providers: Array<"claude" | "codex">;
  title: string;
  digests: SessionDigest[];
  rollup?: WorkSessionRollup;
};

export type DailyNote = {
  schema: "daily.note.v1";
  repo: {
    id: string;
    name: string;
    rootHash: string;
    branch?: string;
  };
  user: {
    idHash: string;
    displayName?: string;
  };
  date: string;
  timezone: string;
  generatedAt: string;
  source: {
    conversationIds: string[];
    digestHashes: string[];
    convosVersion?: string;
    dailyVersion: string;
  };
  standup: {
    done: string[];
    next: string[];
    blockers: string[];
  };
  daySummary: {
    short: string;
    themes: string[];
  };
  workSessions: WorkSession[];
  decisions: SessionDigest["decisions"];
  experiments: SessionDigest["experiments"];
  designSeeds: SessionDigest["designNotes"];
  followUps: SessionDigest["followUps"];
  risks: SessionDigest["risks"];
  metrics?: {
    conversations: number;
    toolCalls: number;
    filesRead: number;
    filesWritten: number;
    testsRun: number;
    testFailures: number;
    tokensTotal?: number;
  };
  sourceCaveats: string[];
};
