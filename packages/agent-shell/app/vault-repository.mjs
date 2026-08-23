import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeMarkdownPath } from "./vault-documents.mjs";

/** Creates the single filesystem and Git mutation boundary for the vault. */
export function createVaultRepository({ root, runGit, reportError = console.error }) {
  /** Writes one Markdown file atomically and returns its normalized path. */
  async function writeMarkdown(file, text) {
    const safe = safeMarkdownPath(root, file);
    if (!safe) throw new Error(`unsafe vault path: ${file}`);
    await mkdir(path.dirname(safe.absolute), { recursive: true });
    const temporary = `${safe.absolute}.tangent-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, safe.absolute);
    return safe.relative;
  }

  /** Commits exactly the supplied paths with Tangent provenance trailers. */
  async function commit(paths, message, area, session = null) {
    const trailers = [`Tangent-Area: ${area}`, session ? `Tangent-Tmux: ${session}` : null].filter(Boolean);
    try {
      await runGit(["-C", root, "commit", "-m", message, "-m", trailers.join("\n"), "--", ...paths]);
    } catch (error) {
      reportError(`vault commit failed: ${paths.join(", ")}: ${String(error.stderr ?? error.message ?? error).slice(0, 200)}`);
    }
  }

  /** Atomically writes and commits one Markdown file. */
  async function writeAndCommit(file, text, message, area, session = null) {
    const relative = await writeMarkdown(file, text);
    await commit([relative], message, area, session);
    return relative;
  }

  return { commit, writeAndCommit, writeMarkdown };
}
