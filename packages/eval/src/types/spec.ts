import type { EvalContextMode } from "./context.js";
import type { EvalAgentConfig } from "./provider.js";

export type EvalRepoSpec = {
  path: string;
  ref: string;
};

export type EvalPhaseId = "plan" | "implement";

export type EvalPhaseSpec =
  | EvalPhaseId
  | {
      id: EvalPhaseId;
      mode?: "read-only" | "workspace-write" | "danger-full-access";
      commit?: boolean;
    };

export type EvalDefaults = {
  repo?: EvalRepoSpec;
  cwd?: string;
  agent?: EvalAgentConfig;
  phases?: EvalPhaseSpec[];
};

export type EvalVariantSpec = {
  id: string;
  prompt?: string;
  repo?: EvalRepoSpec;
  cwd?: string;
  context?: EvalContextMode;
  agent?: EvalAgentConfig;
  phases?: EvalPhaseSpec[];
};

export type EvalCaseSpec = {
  id: string;
  prompt?: string;
  cwd?: string;
  phases?: EvalPhaseSpec[];
  variants: EvalVariantSpec[];
};

export type EvalSpec = {
  schema: "eval.spec.v1";
  name: string;
  defaults?: EvalDefaults;
  cases: EvalCaseSpec[];
};

export type ResolvedEvalVariant = {
  caseId: string;
  variantId: string;
  promptPath: string;
  prompt: string;
  repo: EvalRepoSpec;
  cwd: string;
  context: EvalContextMode;
  agent: EvalAgentConfig;
  phases: Array<{
    id: EvalPhaseId;
    mode: "read-only" | "workspace-write" | "danger-full-access";
    commit: boolean;
  }>;
};
