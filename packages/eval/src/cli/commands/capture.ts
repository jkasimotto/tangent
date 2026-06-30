import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requiredString, stringArg, type Args } from "../args.js";
import { agentFromArgs, phasesFromArgs, variantsFromArgs } from "./shared.js";
import type { EvalSpec } from "../../types/spec.js";

export async function captureCommand(args: Args): Promise<void> {
  const subcommand = args._[1];
  if (subcommand !== "task") throw new Error(`Unknown eval capture command: ${subcommand || ""}`);
  const id = requiredString(args._[2], "eval capture task requires <id>.");
  const promptSource = requiredString(args.prompt, "eval capture task requires --prompt <path|->.");
  const prompt = promptSource === "-" ? await readStdin() : await readFile(path.resolve(promptSource), "utf8");
  const dir = path.resolve("evals", id);
  const promptRel = "prompts/task.md";
  await mkdir(path.join(dir, "prompts"), { recursive: true });
  await writeFile(path.join(dir, promptRel), prompt, "utf8");

  const spec: EvalSpec = {
    schema: "eval.spec.v1",
    name: id,
    defaults: {
      repo: {
        path: stringArg(args.repo) || ".",
        ref: stringArg(args["repo-ref"]) || "HEAD"
      },
      cwd: stringArg(args.cwd) || ".",
      agent: agentFromArgs(args),
      phases: phasesFromArgs(args.phases)
    },
    cases: [
      {
        id,
        prompt: promptRel,
        variants: variantsFromArgs(args)
      }
    ]
  };
  const specPath = path.join(dir, "eval.json");
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  console.log(`eval:   ${specPath}`);
  console.log(`prompt: ${path.join(dir, promptRel)}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
