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

export type EvalCriterion = {
  id: string;
  statement: string;
  points?: number;
};

export type EvalEvaluatorSpec = {
  model: string;
  criteria: EvalCriterion[];
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
  evaluator?: EvalEvaluatorSpec;
  /**
   * The id of the mark (`tangent.mark.v1`, see marks/types.ts) that this eval was scaffolded from,
   * when it was created via `tangent mark to-eval`. The report renderers print it as the link back
   * to the originating failure or candidate, so a reviewer can trace the fix to the moment that
   * motivated it. Absent for evals authored directly, e.g. via `tangent eval capture task`.
   */
  markId?: string;
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
