import { spawn } from "node:child_process";

const defaultExcludes = [".tangent/search", ".repo_scope", ".git", "node_modules", ".dart_tool", "build", "dist", "coverage"];

/** Runs grep. */
export async function runGrep(command: "grep" | "rg" | "find", argv: string[]): Promise<number> {
  const args = command === "grep" ? grepArgs(argv) : command === "rg" ? rgArgs(argv) : findArgs(argv);
  return spawnCommand(command, args);
}

/** Supports the grep args helper. */
function grepArgs(argv: string[]): string[] {
  const excludes = defaultExcludes.flatMap((dir) => ["--exclude-dir", dir]);
  return ["-I", ...excludes, ...argv];
}

/** Supports the rg args helper. */
function rgArgs(argv: string[]): string[] {
  const excludes = defaultExcludes.flatMap((dir) => ["--glob", `!${dir}/**`]);
  return [...excludes, ...argv];
}

/** Finds args. */
function findArgs(argv: string[]): string[] {
  if (!argv.length) return ["."];
  return argv;
}

/** Supports the spawn command helper. */
function spawnCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}
