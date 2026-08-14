import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";

import { gitRaw, gitText } from "@tangent/repo/git";

import type { RepositorySnapshot, ReviewedArtifactIdentity, ReviewedCompletionEnvelope, ReviewedRun, ReviewedStepState } from "./types.js";

/** Captures content identities for every tracked or untracked worktree change. */
export async function repositorySnapshot(repository: string): Promise<RepositorySnapshot> {
  const [changedText, untrackedText] = await Promise.all([
    gitRaw(repository, ["diff", "--name-only", "-z", "HEAD"]),
    gitRaw(repository, ["ls-files", "--others", "--exclude-standard", "-z"])
  ]);
  const names = new Set([...nulPaths(changedText), ...nulPaths(untrackedText)]);
  const snapshot: RepositorySnapshot = {};
  for (const name of [...names].sort()) snapshot[name] = await worktreeIdentity(repository, name);
  return snapshot;
}

/** Lists paths whose current worktree identity differs between two snapshots. */
export function changedSnapshotPaths(before: RepositorySnapshot, after: RepositorySnapshot): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((name) => before[name] !== after[name]).sort();
}

/** Creates one stable identity for a snapshot or a subset of its paths. */
export function snapshotIdentity(snapshot: RepositorySnapshot, paths = Object.keys(snapshot)): string {
  const hash = createHash("sha256");
  for (const name of [...paths].sort()) hash.update(`${name}\0${snapshot[name] ?? "<clean>"}\0`);
  return hash.digest("hex");
}

/** Validates a step envelope and returns durable identities for every artifact. */
export async function validateStepHandoff(args: {
  run: ReviewedRun;
  step: ReviewedStepState;
  attempt: number;
  envelope: ReviewedCompletionEnvelope;
  before: RepositorySnapshot;
  after: RepositorySnapshot;
}): Promise<{ artifacts: ReviewedArtifactIdentity[]; changedPaths: string[] }> {
  const { run, step, envelope } = args;
  const changedPaths = changedSnapshotPaths(args.before, args.after);
  for (const purpose of step.requiredArtifacts) {
    if (!envelope.artifacts.some((artifact) => artifact.purpose === purpose)) {
      throw new Error(`${step.label} did not return the required ${purpose} artifact.`);
    }
  }
  if (step.requiresProof && !envelope.proof.length) throw new Error(`${step.label} did not return command proof.`);
  if (step.requiresRepositoryChange && !changedPaths.length) throw new Error(`${step.label} did not change the repository.`);

  const artifacts: ReviewedArtifactIdentity[] = [];
  const artifactPaths = new Set<string>();
  for (const artifact of envelope.artifacts) {
    const relative = normalizeArtifactPath(artifact.path);
    const absolute = path.resolve(run.repository.root, relative);
    if (!inside(run.repository.root, absolute)) throw new Error(`Artifact escapes the repository: ${artifact.path}`);
    const resolved = await realpath(absolute).catch(() => "");
    if (!resolved || !inside(run.repository.root, resolved)) throw new Error(`Artifact does not exist inside the repository: ${artifact.path}`);
    const stats = await lstat(absolute);
    if (!stats.isFile() && !stats.isSymbolicLink()) throw new Error(`Artifact is not a file: ${artifact.path}`);
    if (!changedPaths.includes(relative)) throw new Error(`Artifact did not change during this step: ${relative}`);
    const hash = await worktreeIdentity(run.repository.root, relative);
    artifacts.push({
      path: relative,
      purpose: artifact.purpose,
      repository: run.repository.root,
      stepId: step.id,
      attempt: args.attempt,
      hash,
      absolutePath: absolute
    });
    artifactPaths.add(relative);
  }

  if (step.restrictChangesToArtifacts) {
    const unexpected = changedPaths.filter((name) => !artifactPaths.has(name));
    if (unexpected.length) throw new Error(`${step.label} changed files outside its artifact contract: ${unexpected.join(", ")}`);
  }
  if (step.review) await validateReviewResults(artifacts, envelope);
  return { artifacts, changedPaths };
}

/** Reads the repository HEAD and current branch for a new Run. */
export async function repositoryRevision(repository: string): Promise<{ head: string; branch?: string }> {
  const [head, branch] = await Promise.all([
    gitText(repository, ["rev-parse", "HEAD"]),
    gitText(repository, ["branch", "--show-current"]).catch(() => "")
  ]);
  return { head, branch: branch || undefined };
}

/** Returns a readable current diff while keeping the Run baseline explicit. */
export async function repositoryDiff(repository: string): Promise<string> {
  const [diff, untracked] = await Promise.all([
    gitRaw(repository, ["diff", "--no-ext-diff", "HEAD"]),
    gitRaw(repository, ["ls-files", "--others", "--exclude-standard"])
  ]);
  const suffix = untracked.trim() ? `\nUntracked files:\n${untracked.trim()}\n` : "";
  return `${diff}${suffix}` || "No worktree diff.\n";
}

/** Reads an artifact only after it matches the identity recorded in a Run. */
export async function readRecordedArtifact(artifact: ReviewedArtifactIdentity): Promise<string> {
  const current = await worktreeIdentity(artifact.repository, artifact.path);
  if (current !== artifact.hash) throw new Error(`Artifact changed after this handoff: ${artifact.path}`);
  return readFile(artifact.absolutePath, "utf8");
}

/** Validates the required first line of a review artifact. */
async function validateReviewResults(artifacts: ReviewedArtifactIdentity[], envelope: ReviewedCompletionEnvelope): Promise<void> {
  const review = artifacts.find((artifact) => /review$/.test(artifact.purpose) || artifact.purpose === "implementation-review");
  if (!review) throw new Error("The review step did not return a review artifact.");
  const text = await readFile(review.absolutePath, "utf8");
  const match = text.match(/^\s*(?:#\s*)?Result:\s*(pass|changes_requested|needs_judgment)\s*$/im);
  if (!match) throw new Error(`${review.path} must start with Result: pass, changes_requested, or needs_judgment.`);
  if (match[1] === "needs_judgment" && envelope.status !== "needs_judgment") {
    throw new Error("A needs_judgment review result must pause with a question.");
  }
}

/** Hashes one worktree file, symlink target, or deletion marker. */
async function worktreeIdentity(repository: string, relative: string): Promise<string> {
  const absolute = path.join(repository, relative);
  const stats = await lstat(absolute).catch(() => undefined);
  if (!stats) return "<deleted>";
  const hash = createHash("sha256");
  if (stats.isSymbolicLink()) hash.update(`symlink\0${await readlink(absolute)}`);
  else if (stats.isFile()) hash.update(await readFile(absolute));
  else hash.update(`<${stats.mode}>`);
  return hash.digest("hex");
}

/** Splits NUL-delimited Git paths. */
function nulPaths(text: string): string[] {
  return text.split("\0").filter(Boolean);
}

/** Normalizes a declared repository-relative artifact path. */
function normalizeArtifactPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Artifact path must be repository-relative: ${value}`);
  }
  return normalized;
}

/** Tests whether a path is equal to or below one root. */
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
