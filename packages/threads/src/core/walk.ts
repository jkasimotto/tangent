import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Recursively lists vault-relative file paths under `root` whose filename satisfies `isMatch`,
 * excluding any `shared/` subtree (team-facing git repos, not private vault state; the same
 * exemption the vault's own lint applies) and any dotfile or dot-directory. Shared by vault-scan's
 * markdown walk and recur's `recur-*.md` walk so the skip-shared/skip-dotfile traversal rule lives in
 * exactly one place.
 */
export async function walkFiles(root: string, isMatch: (fileName: string) => boolean, relativeDir = ""): Promise<string[]> {
  const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "shared") continue;
      files.push(...await walkFiles(root, isMatch, relativePath));
      continue;
    }
    if (entry.isFile() && isMatch(entry.name)) files.push(relativePath);
  }
  return files;
}
