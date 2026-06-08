import type { TopicRollup } from "./digest.js";

export type DailyNote = {
  schema: "daily.note.v2";
  repo: {
    id: string;
    name: string;
    rootHash: string;
    branch?: string;
  };
  date: string;
  timezone: string;
  generatedAt: string;
  source: {
    turnKeys: string[];
    providers: Array<"claude" | "codex">;
    topicKeys: string[];
    dailyVersion: string;
  };
  topics: TopicRollup[];
  metrics?: {
    turns: number;
    topics: number;
    toolCalls: number;
    commandCalls: number;
    filesTouched: number;
    activeAgentWallTimeMs?: number;
  };
  sourceCaveats: string[];
};
