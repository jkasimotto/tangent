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

  /**
   * Commits exactly the supplied paths with Tangent provenance trailers, and
   * reports the outcome. A failed commit still logs and never throws, because
   * the file edit already happened; the result lets a caller that must not act
   * on an uncommitted file, such as Journal capture, stop instead.
   */
  async function commit(paths, message, area, session = null) {
    const trailers = [`Tangent-Area: ${area}`, session ? `Tangent-Tmux: ${session}` : null].filter(Boolean);
    try {
      await runGit(["-C", root, "commit", "-m", message, "-m", trailers.join("\n"), "--", ...paths]);
      return { committed: true, error: null };
    } catch (error) {
      const reason = String(error.stderr ?? error.message ?? error).slice(0, 200);
      reportError(`vault commit failed: ${paths.join(", ")}: ${reason}`);
      return { committed: false, error: reason };
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
