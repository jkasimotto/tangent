import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeMarkdownPath } from "./vault-documents.mjs";

/** Creates the single filesystem and Git mutation boundary for the vault. */
export function createVaultRepository({ root, runGit, reportError = console.error }) {
  /** Returns trimmed stdout from one repository command. */
  async function gitText(args, options = {}) {
    const result = await runGit(["-C", root, ...args], options);
    return String(result?.stdout ?? result ?? "").trim();
  }

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

  /** Builds one exact-path commit from memory without touching the shared index or worktree. */
  async function prepareExactCommit({ files, message, area, session = null, operationId = null }) {
    const expectedHead = await gitText(["rev-parse", "HEAD"]);
    const ref = await gitText(["symbolic-ref", "-q", "HEAD"]);
    if (!expectedHead || !ref) throw new Error("the vault must have an attached HEAD");
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "tangent-map-index-"));
    const indexFile = path.join(temporaryRoot, "index");
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    try {
      await runGit(["-C", root, "read-tree", expectedHead], { env });
      const preparedFiles = [];
      for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
        if (!file.path || path.posix.isAbsolute(file.path) || path.posix.normalize(file.path) !== file.path || file.path.startsWith("../")) throw new Error(`unsafe vault commit path: ${file.path}`);
        if (file.content === null) {
          await runGit(["-C", root, "update-index", "--remove", "--", file.path], { env });
          preparedFiles.push({ path: file.path, content: null, blob: null, mode: file.mode ?? "100644" });
          continue;
        }
        const source = path.join(temporaryRoot, `blob-${preparedFiles.length}`);
        await writeFile(source, file.content);
        const blob = await gitText(["hash-object", "-w", source], { env });
        const mode = file.mode ?? "100644";
        await runGit(["-C", root, "update-index", "--add", "--cacheinfo", mode, blob, file.path], { env });
        preparedFiles.push({ path: file.path, content: file.content, blob, mode });
      }
      const tree = await gitText(["write-tree"], { env });
      const trailers = [
        `Tangent-Area: ${area}`,
        session ? `Tangent-Tmux: ${session}` : null,
        operationId ? `Tangent-Map-Operation: ${operationId}` : null,
      ].filter(Boolean).join("\n");
      const commit = await gitText(["commit-tree", tree, "-p", expectedHead, "-m", message, "-m", trailers], { env });
      return { expectedHead, ref, tree, commit, files: preparedFiles };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  /** Installs one prepared commit only while its expected branch head is current. */
  async function installPreparedCommit(prepared) {
    await runGit(["-C", root, "update-ref", prepared.ref, prepared.commit, prepared.expectedHead]);
  }

  /** Updates only the prepared paths in the shared Git index. */
  async function updatePreparedIndex(prepared) {
    for (const file of prepared.files) {
      if (file.content === null) await runGit(["-C", root, "update-index", "--remove", "--", file.path]);
      else await runGit(["-C", root, "update-index", "--add", "--cacheinfo", file.mode, file.blob, file.path]);
    }
  }

  return { commit, installPreparedCommit, prepareExactCommit, updatePreparedIndex, writeAndCommit, writeMarkdown };
}
