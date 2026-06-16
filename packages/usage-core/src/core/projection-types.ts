import type { UsageJsonlLineV1 } from "./schema/usage-jsonl-v1.js";
import type {
  UsageContentMode,
  UsageEventV3,
  UsageProviderCapabilities,
  UsageSession,
  UsageSourceRef,
  UsageStep,
  UsageToolCall,
  UsageToolResult,
  UsageTurn,
  UsageMessage,
  UsageWarning
} from "../schema/index.js";

export type UsageProjectionInput = {
  events: Array<UsageEventV3 | UsageJsonlLineV1>;
  contentMode?: UsageContentMode;
  warnings?: UsageWarning[];
  sources?: UsageSourceRef[];
  capabilities?: UsageProviderCapabilities[];
  index?: {
    kind: "sqlite" | "memory";
    path?: string;
    version?: string;
  };
};

export type UsageProjections = {
  schema: "tangent.usage.projections.v1";
  sessions: UsageSession[];
  turns: UsageTurn[];
  steps: UsageStep[];
  messages: UsageMessage[];
  toolCalls: UsageToolCall[];
  toolResults: UsageToolResult[];
  usageSamples: UsageStep[];
  rawEvents: UsageEventV3[];
  warnings: UsageWarning[];
  sources: UsageSourceRef[];
  capabilities: UsageProviderCapabilities[];
  index?: {
    kind: "sqlite" | "memory";
    path?: string;
    version?: string;
  };
};

export type AnnotatedUsageEvent = UsageEventV3 & {
  _order: number;
  _turnOrder?: number;
};
