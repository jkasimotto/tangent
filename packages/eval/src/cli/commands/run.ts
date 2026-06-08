import path from "node:path";

import { booleanArg, stringArg, stringsArg, type Args } from "../args.js";
import { loadEvalSpec, resolveVariants } from "../../core/config.js";
import { collectEval } from "../../core/metrics.js";
import { runPreparedEval } from "../../core/run.js";
import { prepareEval } from "../../core/worktree.js";
import type { LoadedEvalSpec } from "../../core/config.js";
import type { EvalSpec } from "../../types/spec.js";
import { agentFromArgs, contextsFromArgs, phasesFromArgs, variantIdFromContext } from "./shared.js";

export async function runCommand(args: Args): Promise<void> {
  const specPath = stringArg(args._[1]);
  const loaded = specPath ? await loadEvalSpec(specPath) : await shortcutLoadedSpec(args);
  const prepared = await prepareEval(loaded);
  await runPreparedEval(prepared.manifest);
  const collected = await collectEval(prepared.manifest);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify({ run: collected.manifest, metrics: collected.metrics }, null, 2));
    return;
  }
  console.log(`run: ${collected.manifest.id}`);
  console.log(`dir: ${collected.manifest.runDir}`);
}

async function shortcutLoadedSpec(args: Args): Promise<LoadedEvalSpec> {
  const prompts = stringsArg(args.prompt);
  if (prompts.length === 0) throw new Error("eval run shortcut mode requires --prompt <path>; otherwise pass <eval.json>.");
  const contexts = contextsFromArgs(args);
  const invocationCwd = process.cwd();
  const cases = prompts.map((promptPath, promptIndex) => ({
    id: caseIdFromPrompt(promptPath, promptIndex),
    prompt: promptPath,
    variants: contexts.map((context, contextIndex) => ({
      id: context.mode === "snapshot" ? variantIdFromContext(context.ref) : context.mode === "git-ref" ? `git-ref-${contextIndex + 1}` : variantIdFromContext(context.mode),
      context
    }))
  }));
  const spec: EvalSpec = {
    schema: "eval.spec.v1",
    name: "eval-run",
    defaults: {
      repo: {
        path: stringArg(args["repo-path"]) || ".",
        ref: stringArg(args.repo) || "HEAD"
      },
      cwd: stringArg(args.cwd) || ".",
      agent: agentFromArgs(args),
      phases: phasesFromArgs(args.phases)
    },
    cases
  };
  return {
    spec,
    specDir: invocationCwd,
    invocationCwd,
    variants: await resolveVariants(spec, { specDir: invocationCwd, invocationCwd })
  };
}

function caseIdFromPrompt(promptPath: string, index: number): string {
  const name = path.basename(promptPath, path.extname(promptPath)).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return name || `prompt-${index + 1}`;
}
