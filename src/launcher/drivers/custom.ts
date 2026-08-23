import { spawn } from "node:child_process";

/**
 * Opens a terminal using a user-supplied shell template string.
 * The template may contain {cmd} and {cwd} tokens which are substituted
 * with the actual command and working directory before execution.
 */
export async function openCustom(template: string, command: string, cwd: string): Promise<void> {
  const resolved = template
    .replace(/\{cmd\}/g, command)
    .replace(/\{cwd\}/g, cwd);
  const child = spawn(resolved, [], { shell: true, stdio: "ignore", detached: true, cwd });
  child.unref();
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
}
