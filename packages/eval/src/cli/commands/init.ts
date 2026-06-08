import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function initCommand(): Promise<void> {
  const evalsDir = path.resolve("evals");
  await mkdir(evalsDir, { recursive: true });
  console.log(`evals initialized: ${evalsDir}`);
}
