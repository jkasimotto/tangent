import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";

/**
 * The parent directory of the `.tangent` data root. Tangent stores its data under
 * `<tangentHome>/.tangent` (feedback.jsonl, features/, trees stores), with `TANGENT_HOME`
 * overriding the OS home dir so tests and verify harnesses can point at a scratch dir.
 * Call sites keep the `.tangent` segment and join their own child (`feedback.jsonl` vs
 * `features/`), so this returns the parent, matching pipeline/dossier.mjs and src/cli/feedback.ts.
 */
export function tangentHome(): string {
  return process.env.TANGENT_HOME || homedir();
}

/** Tests whether a path exists (file or directory), returning false on any access error. */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Tests whether a path is a readable regular file, returning false on any stat error. */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
