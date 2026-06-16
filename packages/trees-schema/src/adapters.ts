import type { EvidenceRef, TreeEntity, WorkSession } from "./index.js";

export type AgentCapabilities = {
  supportsPrompt: boolean;
  supportsModel: boolean;
  supportsSandbox: boolean;
  supportsPermissionActions: boolean;
};

export type AgentCommandSpec = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  stdin?: string;
};

export type BuildAgentCommandInput = {
  entity: TreeEntity;
  workSession?: WorkSession;
  prompt?: string;
  cwd: string;
  model?: string;
  sandbox?: string;
  env: Record<string, string>;
};

export type PermissionRequest = {
  id: string;
  agentRunId: string;
  prompt?: string;
  action?: string;
  evidence: EvidenceRef[];
};
