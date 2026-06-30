export type EvalCriterionVerdict = {
  id: string;
  statement: string;
  points: number;
  passed: boolean;
  reasoning: string;
};

export type EvalEvaluation = {
  schema: "eval.evaluation.v1";
  caseId: string;
  variantId: string;
  model: string;
  evaluatedAt: string;
  criteria: EvalCriterionVerdict[];
  totalPoints: number;
  maxPoints: number;
  warnings: string[];
};
