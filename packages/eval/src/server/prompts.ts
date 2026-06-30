import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EvalSpec } from "../types/spec.js";
import type { EvalSpecPromptView, EvalSpecPromptsView } from "./types.js";

// The Eval UI edits the task prompt(s) an eval runs before launching it. A spec references its prompts
// by path (`case.prompt` / `variant.prompt`), resolved relative to the spec's own directory. We read
// those files for the editor and write edits straight back, refusing any path that escapes the spec
// directory so the editor can only touch the eval's own prompts.

/** Reads a spec's editable prompt files (deduped, in spec order) for the prompt editor. */
export async function readSpecPrompts(specPath: string): Promise<EvalSpecPromptsView> {
  const absoluteSpec = path.resolve(specPath);
  const specDir = path.dirname(absoluteSpec);
  const spec = JSON.parse(await readFile(absoluteSpec, "utf8")) as EvalSpec;
  if (spec.schema !== "eval.spec.v1") throw new Error("Not an eval.spec.v1 spec.");

  const prompts: EvalSpecPromptView[] = [];
  const seen = new Set<string>();
  for (const relativePath of promptPaths(spec)) {
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const absolute = resolveWithin(specDir, relativePath);
    const content = await readFile(absolute, "utf8").catch(() => "");
    prompts.push({ id: relativePath, label: promptLabel(relativePath), path: relativePath, content });
  }
  return { specPath: absoluteSpec, name: spec.name || path.basename(absoluteSpec), prompts };
}

/** Writes one edited prompt file back into the spec's directory and returns the refreshed prompt set. */
export async function writeSpecPrompt(specPath: string, promptPath: string, content: string): Promise<EvalSpecPromptsView> {
  const absoluteSpec = path.resolve(specPath);
  const specDir = path.dirname(absoluteSpec);
  const spec = JSON.parse(await readFile(absoluteSpec, "utf8")) as EvalSpec;
  if (spec.schema !== "eval.spec.v1") throw new Error("Not an eval.spec.v1 spec.");
  if (!promptPaths(spec).includes(promptPath)) throw new Error(`Prompt ${promptPath} is not referenced by this spec.`);
  const absolute = resolveWithin(specDir, promptPath);
  await writeFile(absolute, content, "utf8");
  return readSpecPrompts(specPath);
}

/** Lists the prompt paths a spec references, in case-then-variant order. */
function promptPaths(spec: EvalSpec): string[] {
  const paths: string[] = [];
  for (const testCase of spec.cases || []) {
    if (testCase.prompt) paths.push(testCase.prompt);
    for (const variant of testCase.variants || []) {
      if (variant.prompt) paths.push(variant.prompt);
    }
  }
  return paths;
}

/** Resolves a spec-relative prompt path, refusing absolute paths or any that escape the spec directory. */
function resolveWithin(specDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error("Prompt path must be relative to the spec.");
  const absolute = path.resolve(specDir, relativePath);
  const rel = path.relative(specDir, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Prompt path must stay inside the spec directory.");
  return absolute;
}

/** A readable label for a prompt path (its basename without extension, title-cased lightly). */
function promptLabel(relativePath: string): string {
  const base = path.basename(relativePath).replace(/\.[^.]+$/, "");
  return base === "task" ? "Task prompt" : base;
}
