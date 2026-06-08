import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { changedFiles, currentCommit, statusPorcelain } from "@tangent/repo/git";
import { commitAll } from "@tangent/repo/worktree";

import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { runAgent } from "../runners/index.js";
import { implementationPrompt, planPrompt } from "./phase-prompts.js";
import { saveRunManifest } from "./run-store.js";

export async function runPreparedEval(manifest: EvalRunManifest): Promise<EvalRunManifest> {
  const failures: string[] = [];
  for (const variant of manifest.variants) {
    if (variant.agent.kind === "manual") continue;
    try {
      await runVariant(manifest, variant);
    } catch (error) {
      variant.status = "failed";
      variant.error = (error as Error).message;
      failures.push(`${variant.caseId}/${variant.variantId}: ${(error as Error).message}`);
      await saveRunManifest(manifest);
    }
  }
  if (failures.length > 0) throw new Error(`Eval run failed:\n${failures.join("\n")}`);
  return manifest;
}

async function runVariant(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<void> {
  variant.status = "running";
  variant.startedAt ||= new Date().toISOString();
  await saveRunManifest(manifest);

  const task = await readFile(variant.promptPath, "utf8");
  let plan = variant.planPath ? await readFile(variant.planPath, "utf8").catch(() => "") : "";

  for (const phase of variant.phases) {
    if (phase.status === "done") continue;
    phase.status = "running";
    phase.startedAt = new Date().toISOString();
    await saveRunManifest(manifest);

    const phaseBaseCommit = await currentCommit(variant.worktree);
    const prompt = phase.id === "plan" ? planPrompt(task) : implementationPrompt(task, plan);
    if (phase.promptPath) await writeFile(phase.promptPath, prompt, "utf8");
    const output = await runAgent({
      agent: variant.agent,
      prompt,
      cwd: variant.executionCwd,
      sandbox: phase.mode || (phase.id === "plan" ? "read-only" : "workspace-write"),
      env: {
        TANGENT_EVAL_RUN_ID: manifest.id,
        TANGENT_EVAL_CASE_ID: variant.caseId,
        TANGENT_EVAL_VARIANT_ID: variant.variantId,
        TANGENT_EVAL_PHASE: phase.id
      }
    });

    if (phase.id === "plan") {
      plan = output.trim();
      const repoPlanPath = path.join(variant.worktree, "evals", "runs", manifest.id, variant.caseId, variant.variantId, "PLAN.md");
      const artifactPlanPath = path.join(path.dirname(variant.promptPath), "plan.md");
      await mkdir(path.dirname(repoPlanPath), { recursive: true });
      await writeFile(repoPlanPath, `${plan}\n`, "utf8");
      await writeFile(artifactPlanPath, `${plan}\n`, "utf8");
      variant.planPath = artifactPlanPath;
      phase.outputPath = artifactPlanPath;
      phase.commit = await commitAll(variant.worktree, `eval: plan ${variant.caseId} / ${variant.variantId}`, { allowEmpty: true });
      variant.planCommit = phase.commit;
    } else {
      const dirty = await statusPorcelain(variant.worktree);
      const changed = await changedFiles(variant.worktree, phaseBaseCommit).catch(() => []);
      if (dirty || changed.length === 0) {
        phase.commit = await commitAll(variant.worktree, `eval: implement ${variant.caseId} / ${variant.variantId}`, { allowEmpty: changed.length === 0 && !dirty });
      } else {
        phase.commit = await currentCommit(variant.worktree);
      }
      variant.implementationCommit = phase.commit;
      const outputPath = path.join(path.dirname(variant.promptPath), "implementation-output.md");
      await writeFile(outputPath, `${output.trim()}\n`, "utf8");
      phase.outputPath = outputPath;
    }

    phase.endedAt = new Date().toISOString();
    phase.status = "done";
    await saveRunManifest(manifest);
  }

  variant.endedAt = new Date().toISOString();
  variant.status = "done";
  await saveRunManifest(manifest);
}
