import type { TopicRollup } from "./digest.js";
import type { RollupPeriod } from "./period.js";

export type RollupNote = {
  schema: "rollup.note.v1";
  repo: {
    id: string;
    name: string;
    rootHash: string;
    branch?: string;
  };
  period: RollupPeriod;
  timezone: string;
  generatedAt: string;
  source: {
    turnKeys: string[];
    providers: Array<"claude" | "codex">;
    topicKeys: string[];
    rollupVersion: string;
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
