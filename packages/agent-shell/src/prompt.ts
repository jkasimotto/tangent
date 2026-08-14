import type { ReviewedRun, ReviewedStepState } from "./types.js";

/** Builds a complete, provider-independent prompt for one Program step. */
export function buildReviewedStepPrompt(run: ReviewedRun, step: ReviewedStepState): string {
  const priorArtifacts = run.steps
    .flatMap((item) => item.attempts)
    .filter((attempt) => attempt.status === "complete" || attempt.status === "needs_attention")
    .flatMap((attempt) => attempt.artifacts)
    .map((artifact) => `- ${artifact.purpose}: ${artifact.path} (sha256 ${artifact.hash})`);
  const decisions = run.decisions
    .filter((decision) => decision.stepId === step.id)
    .map((decision) => `Question: ${decision.question}\nAnswer: ${decision.answer}`);
  const baseline = Object.keys(run.repository.baseline);
  const required = step.requiredArtifacts.length ? step.requiredArtifacts.join(", ") : "no named document artifact";
  const reviewRule = step.review
    ? "Your review document must start with `Result: pass`, `Result: changes_requested`, or `Result: needs_judgment`. Do not edit the artifact under review."
    : "";
  return `You are executing step ${step.order} of 8 in Tangent's Reviewed build Program.

STEP
${step.label}
${step.instruction}

IMMUTABLE GOAL REQUEST
Goal: ${run.goalTitle}
Done when: ${run.goalDoneWhen || "Not declared."}
Goal source: ${run.goalPath}

${run.originalRequest.trim()}

AREA AND DOCUMENT CONTEXT
${run.context.trim()}

VALIDATED HANDOFF ARTIFACTS
${priorArtifacts.length ? priorArtifacts.join("\n") : "- None. This is the first step."}

${decisions.length ? `USER JUDGMENT FOR THIS RETRY\n${decisions.join("\n\n")}\n` : ""}
REPOSITORY
Root: ${run.repository.root}
Start revision: ${run.repository.head}
Paths that were already dirty before this Run:
${baseline.length ? baseline.map((name) => `- ${name}`).join("\n") : "- None."}

Preserve every unrelated existing change. Obey the repository instructions. Do not merge, deploy, publish, send an external message, create a commit without separate authority, or change the Goal status.

HANDOFF CONTRACT
- Required artifact purposes: ${required}.
- Every artifact path must be relative to the repository and must name a file changed during this step.
- Store design, plan, review, and response documents in the repository's normal project-native location.
- Report each check as an exact command and a short result.
- Use needs_judgment only when a product decision or new authority is required.
- Ordinary requested changes continue to the next planned response step.
${reviewRule}

Return only the structured completion object requested by the output schema. Keep the summary short.`;
}

/** Resolves a fresh or continued provider session for one step. */
export function resolveReviewedSession(run: ReviewedRun, step: ReviewedStepState): { kind: "fresh" } | { kind: "resume"; id: string } {
  validateReviewedSession(run.steps, step);
  if (step.session.mode === "fresh") return { kind: "fresh" };
  const source = requiredStep(run.steps, step.session.fromStepId);
  const sessionId = [...source.attempts].reverse().find((attempt) => attempt.status === "complete" && attempt.sessionId)?.sessionId;
  if (!sessionId) throw new Error(`${step.label} cannot continue ${source.label} because it has no completed provider session.`);
  return { kind: "resume", id: sessionId };
}

/** Validates every continuation choice in one resolved Run. */
export function validateAllReviewedSessions(steps: ReviewedStepState[]): void {
  for (const step of steps) validateReviewedSession(steps, step);
}

/** Validates one continuation against an earlier compatible provider. */
export function validateReviewedSession(steps: ReviewedStepState[], step: ReviewedStepState): void {
  if (step.session.mode === "fresh") return;
  if (step.binding.provider === "gemini") throw new Error("Gemini does not support Reviewed build session continuation.");
  const fromStepId = step.session.fromStepId;
  const source = steps.find((item) => item.id === fromStepId);
  if (!source || source.order >= step.order) throw new Error(`${step.label} must continue an earlier Program step.`);
  if (source.binding.provider !== step.binding.provider) throw new Error(`${step.label} can continue only a ${step.binding.provider} session.`);
}

/** Rejects a fresh session identifier that reused an earlier provider session. */
export function ensureFreshReviewedSession(run: ReviewedRun, step: ReviewedStepState, sessionId: string | undefined): void {
  if (step.session.mode !== "fresh" || !sessionId) return;
  const earlier = run.steps
    .filter((item) => item.order < step.order && item.binding.provider === step.binding.provider)
    .flatMap((item) => item.attempts)
    .some((attempt) => attempt.sessionId === sessionId);
  if (earlier) throw new Error(`${step.label} requested a fresh session, but the provider reused ${sessionId}.`);
}

/** Returns one required step from a resolved Program. */
function requiredStep(steps: ReviewedStepState[], stepId: string): ReviewedStepState {
  const step = steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Unknown Reviewed build step: ${stepId}`);
  return step;
}
