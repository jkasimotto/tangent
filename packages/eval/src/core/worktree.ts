import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveCommit, resolveGitRoot } from "@tangent/repo/git";
import { commitAll, worktreeAdd } from "@tangent/repo/worktree";

import type { LoadedEvalSpec } from "./config.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { applyContextMode } from "./context-snapshot.js";
import { implementationPrompt, planPrompt } from "./phase-prompts.js";
import { createRunManifest, saveRunManifest, variantDir } from "./run-store.js";
import { resolveMaybeRelative, sanitizePathSegment } from "./paths.js";

export type PrepareEvalResult = {
  manifest: EvalRunManifest;
};

export async function prepareEval(loaded: LoadedEvalSpec): Promise<PrepareEvalResult> {
  const manifest = await createRunManifest({
    name: loaded.spec.name,
    specPath: loaded.specPath,
    spec: loaded.spec
  });

  for (const variant of loaded.variants) {
    const sourceRepoInput = resolveMaybeRelative(loaded.invocationCwd, variant.repo.path);
    const repoRoot = await resolveGitRoot(sourceRepoInput);
    const baseCommit = await resolveCommit(repoRoot, variant.repo.ref);
    const dir = variantDir(manifest, variant.caseId, variant.variantId);
    const workParent = path.join(dir, "work");
    const worktree = path.join(workParent, path.basename(repoRoot) || "repo");
    const promptPath = path.join(dir, "prompt.md");
    const planPromptPath = path.join(dir, "plan-prompt.md");
    const implementationPromptPath = path.join(dir, "implement-prompt.md");
    const metricsPath = path.join(dir, "metrics.json");
    const branch = `eval/${sanitizePathSegment(manifest.id)}/${sanitizePathSegment(variant.caseId)}/${sanitizePathSegment(variant.variantId)}`;

    await mkdir(dir, { recursive: true });
    await writeFile(promptPath, variant.prompt, "utf8");
    await writeFile(planPromptPath, planPrompt(variant.prompt), "utf8");
    await writeFile(implementationPromptPath, implementationPrompt(variant.prompt), "utf8");

    await worktreeAdd({ sourceRepo: repoRoot, branch, worktree, commit: baseCommit });
    const context = await applyContextMode({
      sourceRepo: repoRoot,
      worktree,
      workParent,
      cwd: variant.cwd,
      context: variant.context,
      runContextName: `_runs-${manifest.id}-${variant.caseId}-${variant.variantId}`
    });
    const contextCommit = await commitAll(worktree, `eval: context ${variant.variantId}`, { allowEmpty: true });

    const state: EvalRunVariantState = {
      caseId: variant.caseId,
      variantId: variant.variantId,
      status: variant.agent.kind === "manual" ? "manual" : "prepared",
      branch,
      repoRoot,
      baseCommit,
      contextCommit,
      workParent,
      worktree,
      executionCwd: path.resolve(worktree, variant.cwd),
      promptPath,
      metricsPath,
      context: context.appliedContext ? { mode: "snapshot", ref: context.appliedContext } : variant.context,
      agent: variant.agent,
      phases: variant.phases.map((phase) => ({
        id: phase.id,
        mode: phase.mode,
        status: variant.agent.kind === "manual" ? "manual" : "prepared",
        promptPath: phase.id === "plan" ? planPromptPath : implementationPromptPath
      })),
      warnings: context.warnings
    };
    manifest.variants.push(state);
    await saveRunManifest(manifest);
  }

  return { manifest };
}
