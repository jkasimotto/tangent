import path from "node:path";
import { runProcess } from "@tangent/agent-runtime/process";
import { sidecarPath as defaultSidecarPath } from "./paths.js";
import { readSidecar, writeSidecarAtomic } from "./sidecar.js";
import type { RegistryEntry, ThreadResources, ValidationStage } from "./types.js";

export type LifecycleProcessResult = { code: number | null; stdout: string; stderr: string };
export type LifecycleRunner = (command: string, args: string[]) => Promise<LifecycleProcessResult>;

/** Runs one lifecycle process through the shared process primitive. */
const defaultRunner: LifecycleRunner = async (command, args) => {
  const result = await runProcess({ command, args });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
};

/** Persists reviewed validation-surface evidence for a registered thread. */
export async function markValidationReady(options: {
  slug: string;
  verdict: string;
  url?: string;
  sidecarPath?: string;
  now?: Date;
}): Promise<ValidationStage> {
  if (!options.verdict.trim()) throw new Error("validate requires a non-empty verdict question.");
  const file = options.sidecarPath || defaultSidecarPath();
  const sidecar = await readSidecar(file);
  const entry = requireEntry(sidecar.registry, options.slug);
  const validation = { stagedAt: (options.now || new Date()).toISOString(), url: options.url, verdict: options.verdict.trim() };
  await writeSidecarAtomic(file, {
    ...sidecar,
    registry: { ...sidecar.registry, [options.slug]: { ...entry, validation } }
  });
  return validation;
}

export type CleanupStep = { resource: string; target: string; result: "did" | "skipped"; detail: string };

/** Tears down only resources explicitly registered as created. Reused resources are always reported and skipped. */
export async function cleanupThread(options: {
  slug: string;
  sidecarPath?: string;
  run?: LifecycleRunner;
}): Promise<CleanupStep[]> {
  const file = options.sidecarPath || defaultSidecarPath();
  const sidecar = await readSidecar(file);
  const entry = requireEntry(sidecar.registry, options.slug);
  const run = options.run || defaultRunner;
  const steps: CleanupStep[] = [];
  reportReused(entry.reused, steps);

  for (const session of entry.created?.tmuxSessions || []) {
    const found = await run("tmux", ["has-session", "-t", session]);
    if (found.code !== 0) steps.push(skip("tmux", session, "not running"));
    else steps.push(await commandStep(run, "tmux", session, "tmux", ["kill-session", "-t", session]));
  }
  for (const instance of entry.created?.cdevInstances || []) {
    steps.push(await commandStep(run, "cdev", instance, "plz", ["cdev", "rm", instance]));
  }

  const repo = await commonRepo(run, entry.worktree);
  for (const worktree of entry.created?.worktrees || []) {
    if (!repo) steps.push(skip("worktree", worktree, "cannot resolve common git repository"));
    else steps.push(await commandStep(run, "worktree", worktree, "git", ["-C", repo, "worktree", "remove", worktree]));
  }
  for (const branch of entry.created?.branches || []) {
    if (!repo || !entry.baseBranch) {
      steps.push(skip("branch", branch, "base branch or common repository not registered"));
      continue;
    }
    const merged = await run("git", ["-C", repo, "merge-base", "--is-ancestor", branch, entry.baseBranch]);
    if (merged.code !== 0) steps.push(skip("branch", branch, `not merged into ${entry.baseBranch}`));
    else steps.push(await commandStep(run, "branch", branch, "git", ["-C", repo, "branch", "-d", branch]));
  }
  return steps;
}

/** Returns a registry entry or fails with an actionable message. */
function requireEntry(registry: Record<string, RegistryEntry>, slug: string): RegistryEntry {
  const entry = registry[slug];
  if (!entry) throw new Error(`No registered thread named ${JSON.stringify(slug)}.`);
  return entry;
}

/** Appends explicit skipped results for resources the thread only reused. */
function reportReused(resources: ThreadResources | undefined, steps: CleanupStep[]): void {
  for (const [resource, targets] of Object.entries(resources || {})) {
    for (const target of targets || []) steps.push(skip(resource, target, "reused by thread; never removed"));
  }
}

/** Resolves the common repository directory shared by linked worktrees. */
async function commonRepo(run: LifecycleRunner, worktree: string): Promise<string | undefined> {
  const result = await run("git", ["-C", worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (result.code !== 0 || !result.stdout.trim()) return undefined;
  return path.dirname(result.stdout.trim());
}

/** Runs a cleanup command and converts its outcome into a reported step. */
async function commandStep(run: LifecycleRunner, resource: string, target: string, command: string, args: string[]): Promise<CleanupStep> {
  const result = await run(command, args);
  return result.code === 0
    ? { resource, target, result: "did", detail: "removed" }
    : skip(resource, target, result.stderr.trim() || `command exited ${result.code}`);
}

/** Constructs a skipped cleanup result. */
function skip(resource: string, target: string, detail: string): CleanupStep {
  return { resource, target, result: "skipped", detail };
}
