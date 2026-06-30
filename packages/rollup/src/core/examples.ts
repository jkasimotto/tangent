import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/repo";

import type { LoadedRollupConfig } from "./config.js";

export type RollupStyleExample = {
  path: string;
  markdown: string;
};

/** Loads style example files and prior notes to use as rollup prompt context. */
export async function loadRollupStyleExamples(loaded: LoadedRollupConfig, currentDate: string): Promise<RollupStyleExample[]> {
  const config = loaded.config.examples;
  if (!config.enabled || config.maxExamples <= 0) return [];

  const examples: RollupStyleExample[] = [];
  for (const filePath of await markdownFiles(loaded.paths.examplesDir)) {
    if (examples.length >= config.maxExamples) return examples;
    examples.push({ path: filePath, markdown: stripTangentHtmlComments(await readFile(filePath, "utf8")) });
  }

  if (!config.includePreviousNotes) return examples;
  const remaining = config.maxExamples - examples.length;
  if (remaining <= 0) return examples;

  const priorNotes = (await markdownFiles(loaded.paths.notesDir))
    .filter((filePath) => noteDate(filePath) && noteDate(filePath)! < currentDate)
    .sort((a, b) => noteDate(b)!.localeCompare(noteDate(a)!))
    .slice(0, remaining);

  for (const filePath of priorNotes) {
    examples.push({ path: filePath, markdown: stripTangentHtmlComments(await readFile(filePath, "utf8")) });
  }

  return examples;
}

/** Removes tangent HTML comment blocks from markdown before using it as an example. */
export function stripTangentHtmlComments(markdown: string): string {
  return markdown.replace(/<!--\s*tangent:[\s\S]*?-->/g, "").trim();
}

/** Returns a sorted list of .md file paths in the given directory. */
async function markdownFiles(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

/** Extracts the YYYY-MM-DD date from a note filename, or undefined if the name is not a date. */
function noteDate(filePath: string): string | undefined {
  const name = path.basename(filePath, ".md");
  return /^\d{4}-\d{2}-\d{2}$/.test(name) ? name : undefined;
}
