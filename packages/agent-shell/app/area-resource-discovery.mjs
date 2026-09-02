import { createHash } from "node:crypto";
import path from "node:path";

import { gitText } from "@tangent/repo/git";
import { listGitWorktrees } from "@tangent/repo/worktree";
import { mapWithConcurrency } from "./bounded-work.mjs";
import { readAllJobEvidence } from "./job-record.mjs";
import { areaResourceTargetFingerprint } from "./area-resource-catalog.mjs";

const ATTEMPT_LIMIT = 20;
const ATTEMPT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

/** Hashes structured evidence without storing a path in the resulting identity. */
export function discoveryFingerprint(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Returns one normalized absolute discovery path or null for unsafe evidence. */
function discoveryPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) return null;
  return path.normalize(value);
}

/** Resolves one nested attempt folder to the exact Git worktree root. */
async function resolveAttemptWorktree(folder, { signal }) {
  const root = await gitText(folder, ["rev-parse", "--show-toplevel"], { signal });
  return discoveryPath(root);
}

/** Flattens valid recent attempts before applying the fixed count boundary. */
export function recentAreaAttempts(jobs, area, { now = Date.now() } = {}) {
  const cutoff = now - ATTEMPT_WINDOW_MS;
  const attempts = [];
  for (const job of jobs ?? []) {
    if (job?.area !== area) continue;
    for (const run of job.runs ?? []) for (const assignment of run.assignments ?? run.steps ?? []) for (const attempt of assignment.attempts ?? []) {
      const startedAt = Date.parse(attempt?.startedAt ?? "");
      const cwd = discoveryPath(attempt?.cwd);
      if (!Number.isFinite(startedAt) || startedAt < cutoff || !cwd) continue;
      attempts.push({
        startedAt,
        cwd,
        evidence: { kind: "attempt", jobSlug: job.slug, run: Number(run.run), assignmentId: String(assignment.id), attemptId: String(attempt.id) },
      });
    }
  }
  return attempts.sort((left, right) => right.startedAt - left.startedAt || left.cwd.localeCompare(right.cwd)).slice(0, ATTEMPT_LIMIT);
}

/** Builds one resource Suggestion with stable evidence and target fingerprints. */
function suggestion(target, evidence, proposedLabel, provenanceLabel, extraEvidence = null) {
  const targetFingerprint = areaResourceTargetFingerprint(target);
  const evidenceHash = discoveryFingerprint({ evidence, target, extraEvidence });
  return { owner: null, target, evidence, evidenceHash, targetFingerprint, proposedLabel, provenanceLabel };
}

/** Returns the fallback label for one discovered Git worktree. */
function worktreeLabel(entry) {
  if (entry.checkout?.kind === "branch") return String(entry.checkout.branchRef).replace(/^refs\/heads\//, "");
  return path.basename(entry.path);
}

/** Discovers bounded worktree Suggestions from Area repositories and complete Job history. */
export async function discoverAreaResources({
  area,
  repositories = [],
  jobsRoot = null,
  jobsEvidence = null,
  readJobs = readAllJobEvidence,
  listWorktrees = listGitWorktrees,
  resolveAttempt = resolveAttemptWorktree,
  now = Date.now(),
  signal,
  concurrency = 4,
} = {}) {
  if (typeof area !== "string" || !area) throw Object.assign(new Error("A selected Area is required."), { status: 422, code: "invalid-resource-target" });
  const evidence = jobsEvidence ?? (jobsRoot ? await readJobs(jobsRoot) : { jobs: [], problems: [] });
  const attempts = recentAreaAttempts(evidence.jobs, area, { now });
  const repositoryRows = repositories.filter((resource) => resource?.target?.kind === "repository");
  const tasks = [
    ...repositoryRows.map((resource) => ({ kind: "repository", resource })),
    ...attempts.map((attempt) => ({ kind: "attempt", attempt })),
  ];
  const settled = await mapWithConcurrency(tasks, concurrency, async (task) => {
    if (signal?.aborted) throw Object.assign(new Error("Discovery was cancelled."), { name: "AbortError" });
    if (task.kind === "repository") {
      const repository = task.resource;
      try {
        const entries = await listWorktrees(repository.target.path, { signal });
        const suggestions = [];
        const diagnostics = [];
        for (const entry of entries) {
          const candidatePath = discoveryPath(entry.path);
          if (!candidatePath) { diagnostics.push({ code: "invalid-worktree-path", message: "Git returned an unsafe worktree path." }); continue; }
          if (entry.checkout?.kind === "bare") { diagnostics.push({ code: "bare-worktree", path: candidatePath, message: "Git reported a bare checkout; it is not a worktree candidate." }); continue; }
          if (entry.prunable) { diagnostics.push({ code: "prunable-worktree", path: candidatePath, message: entry.prunable.reason || "Git reports this worktree as prunable." }); continue; }
          const target = { kind: "worktree", path: candidatePath };
          const sourceTargetFingerprint = areaResourceTargetFingerprint(repository.target);
          const itemEvidence = { kind: "git-worktree", repositoryTargetFingerprint: sourceTargetFingerprint, pathFingerprint: discoveryFingerprint(candidatePath) };
          suggestions.push(suggestion(target, itemEvidence, worktreeLabel(entry), `Worktree of ${repository.label ?? path.basename(repository.target.path)}`, { checkout: entry.checkout, locked: entry.locked }));
        }
        return { source: { kind: "repository", resource: repository.locator }, state: diagnostics.length ? "partial" : "complete", suggestions, diagnostics };
      } catch {
        return { source: { kind: "repository", resource: repository.locator }, state: "error", suggestions: [], diagnostics: [{ code: "repository-inspection-failed", message: "Could not inspect the recorded repository.", retryable: true }] };
      }
    }
    try {
      const root = await resolveAttempt(task.attempt.cwd, { signal });
      if (!root) return { source: task.attempt.evidence, state: "error", suggestions: [], diagnostics: [{ code: "attempt-not-worktree", message: "The Attempt folder is not inside a Git worktree." }] };
      const target = { kind: "worktree", path: root };
      return {
        source: task.attempt.evidence,
        state: "complete",
        suggestions: [suggestion(target, task.attempt.evidence, path.basename(root), `Used by Goal ${task.attempt.evidence.jobSlug}`, { cwd: task.attempt.cwd, startedAt: task.attempt.startedAt })],
        diagnostics: [],
      };
    } catch {
      return { source: task.attempt.evidence, state: "error", suggestions: [], diagnostics: [{ code: "attempt-inspection-failed", message: "Could not inspect the recorded Attempt folder.", retryable: true }] };
    }
  });
  const suggestions = settled.flatMap((result) => result.suggestions).map((item) => ({ ...item, owner: area }));
  const sourceProblems = settled.flatMap((result) => result.diagnostics.map((problem) => ({ source: result.source, ...problem })));
  const problems = [
    ...(evidence.problems ?? []).map((problem) => ({ source: { kind: "job-record", file: problem.file }, code: problem.code, message: problem.message, retryable: problem.retryable })),
    ...sourceProblems,
  ];
  return {
    state: problems.length ? "partial" : "current",
    area,
    limits: { attempts: ATTEMPT_LIMIT, days: 30, concurrency },
    suggestions,
    sources: settled,
    problems,
  };
}

export default { discoverAreaResources, discoveryFingerprint, recentAreaAttempts };
