import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Handles the `eval init` subcommand, creating the local evals directory. */
export async function initCommand(): Promise<void> {
  const evalsDir = path.resolve("evals");
  await mkdir(evalsDir, { recursive: true });
  console.log(`evals initialized: ${evalsDir}`);
}
