import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { git, gitText, listFilesAtRef, resolveCommit, resolveGitRoot, showFile, showFileFollowingSymlinks } from "@tangent/repo/git";
import { createSyntheticCommit } from "@tangent/repo/worktree";

import { contextPatterns, type EvalContextFile, type EvalContextManifest, type EvalContextMode } from "../types/context.js";
import { contextDirNames, contextFileNames, discoverContextFiles, pathMatchesContextDiscovery } from "./context-discovery.js";
import { sha256, shortHash } from "./hash.js";
import { contextRef } from "./paths.js";

export type CaptureContextOptions = {
  name: string;
  repo: string;
  cwd?: string;
  includeAncestors?: boolean;
  includeDirtyContext?: boolean;
  fromRef?: string;
  empty?: boolean;
};

export type CaptureContextResult = {
  ref: string;
  commit: string;
  manifest: EvalContextManifest;
};

type SnapshotFile = {
  manifestFile: EvalContextFile;
  content: string;
};

/** Captures the context files at a worktree or ref into a synthetic commit, returning its ref, commit, and manifest. */
export async function captureContextSnapshot(options: CaptureContextOptions): Promise<CaptureContextResult> {
  const repoRoot = await resolveGitRoot(path.resolve(options.repo));
  const cwd = normalizeCwd(options.cwd || ".");
  const ref = contextRef(options.name);
  const repoHead = await resolveCommit(repoRoot, options.fromRef || "HEAD").catch(() => undefined);
  const files = options.empty
    ? []
    : options.fromRef
      ? await snapshotFilesFromRef({ repoRoot, ref: options.fromRef, cwd, includeAncestors: Boolean(options.includeAncestors) })
      : await snapshotFilesFromWorktree({ repoRoot, cwd, includeAncestors: Boolean(options.includeAncestors), includeDirtyContext: Boolean(options.includeDirtyContext) });

  const createdAt = new Date().toISOString();
  const manifest: EvalContextManifest = {
    schema: "eval.context.v1",
    id: `ctx_${shortHash(`${repoRoot}:${cwd}:${createdAt}:${ref}`)}`,
    createdAt,
    source: {
      repoRoot,
      repoHead,
      cwd,
      ref: options.fromRef,
      empty: Boolean(options.empty),
      dirtyContextIncluded: Boolean(options.includeDirtyContext)
    },
    discovery: {
      cwd,
      includeAncestors: Boolean(options.includeAncestors),
      patterns: [...contextPatterns]
    },
    files: files.map((file) => file.manifestFile)
  };

  const commit = await createSyntheticCommit({
    repo: repoRoot,
    ref,
    message: `eval: context snapshot ${ref.replace(/^refs\/tangent\/eval\/contexts\//, "")}`,
    files: [
      { path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
      ...files.map((file) => ({ path: file.manifestFile.snapshotPath, content: file.content }))
    ]
  });
  return { ref, commit, manifest };
}

/** Reads and validates the manifest.json stored at a context snapshot ref. */
export async function readContextManifest(repo: string, ref: string): Promise<EvalContextManifest> {
  const repoRoot = await resolveGitRoot(path.resolve(repo));
  const raw = await showFile(repoRoot, ref, "manifest.json");
  const manifest = JSON.parse(raw) as EvalContextManifest;
  if (manifest.schema !== "eval.context.v1") throw new Error(`Not an eval context snapshot: ${ref}`);
  return manifest;
}

/** Materializes a variant's context into its worktree per the requested mode (repo, empty, snapshot, or git-ref), returning the applied ref and any warnings. */
export async function applyContextMode(args: {
  sourceRepo: string;
  worktree: string;
  workParent: string;
  cwd: string;
  context: EvalContextMode;
  runContextName?: string;
}): Promise<{ appliedContext?: string; warnings: string[] }> {
  const warnings: string[] = [];
  if (args.context.mode === "repo") {
    warnings.push("repo context mode leaves repository context files as checked out at the base commit.");
    return { warnings };
  }

  await deleteRepoContextFiles(args.worktree);

  if (args.context.mode === "empty") {
    warnings.push("empty context mode cannot suppress provider-level global configuration.");
    return { warnings };
  }

  let snapshotRef: string;
  if (args.context.mode === "git-ref") {
    if (!args.runContextName) throw new Error("git-ref context application requires runContextName.");
    const captured = await captureContextSnapshot({
      name: args.runContextName,
      repo: args.sourceRepo,
      cwd: args.cwd,
      includeAncestors: true,
      fromRef: args.context.ref
    });
    snapshotRef = captured.ref;
  } else {
    snapshotRef = args.context.ref;
  }

  const sourceRoot = await resolveGitRoot(args.sourceRepo);
  const manifest = await readContextManifest(sourceRoot, snapshotRef);
  for (const file of manifest.files) {
    const content = await showFile(sourceRoot, snapshotRef, file.snapshotPath);
    const destination = file.scope === "repo"
      ? path.join(args.worktree, file.path)
      : path.join(ancestorBase(args.workParent, file.depth || 1), file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  return { appliedContext: snapshotRef, warnings };
}

/** Discovers and reads context files from the working tree, rejecting uncommitted repo context unless dirty capture is allowed. */
async function snapshotFilesFromWorktree(args: {
  repoRoot: string;
  cwd: string;
  includeAncestors: boolean;
  includeDirtyContext: boolean;
}): Promise<SnapshotFile[]> {
  const discovered = await discoverContextFiles({
    repoRoot: args.repoRoot,
    cwd: args.cwd,
    includeAncestors: args.includeAncestors,
    includeExternalAncestors: false
  });
  const repoPaths = discovered.filter((file) => file.scope === "repo").map((file) => file.path);
  if (!args.includeDirtyContext && repoPaths.length > 0) {
    const dirty = await dirtyContextPaths(args.repoRoot, repoPaths);
    if (dirty.length > 0) {
      throw new Error(`Context files have uncommitted changes; pass --include-dirty-context to capture them: ${dirty.join(", ")}`);
    }
  }
  const rows: SnapshotFile[] = [];
  for (const file of discovered) {
    const content = await readFile(file.sourcePath, "utf8");
    rows.push({
      manifestFile: {
        scope: file.scope,
        depth: file.depth,
        path: file.path,
        snapshotPath: file.snapshotPath,
        sha256: sha256(content)
      },
      content
    });
  }
  return rows;
}

/** Lists and reads the context files matching discovery at a git ref, following symlinks to their target content. */
async function snapshotFilesFromRef(args: {
  repoRoot: string;
  ref: string;
  cwd: string;
  includeAncestors: boolean;
}): Promise<SnapshotFile[]> {
  const paths = (await listFilesAtRef(args.repoRoot, args.ref))
    .filter((filePath) => pathMatchesContextDiscovery(filePath, args.cwd, args.includeAncestors))
    .sort();
  const rows: SnapshotFile[] = [];
  for (const filePath of paths) {
    const content = await showFileFollowingSymlinks(args.repoRoot, args.ref, filePath);
    rows.push({
      manifestFile: {
        scope: "repo",
        path: filePath,
        snapshotPath: `repo/${filePath}`,
        sha256: sha256(content)
      },
      content
    });
  }
  return rows;
}

/** Removes ALL context files (CLAUDE.md, AGENTS.md, .claude/ etc.) from the entire worktree tree. */
async function deleteRepoContextFiles(worktree: string): Promise<void> {
  await deleteContextFilesInDir(worktree);
}

/** Recursively deletes all context files and directories found anywhere under dir, skipping .git. */
async function deleteContextFilesInDir(dir: string): Promise<void> {
  for (const name of contextFileNames) await rm(path.join(dir, name), { force: true });
  for (const name of contextDirNames) await rm(path.join(dir, name), { recursive: true, force: true });
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || contextDirNames.has(entry.name) || entry.name === ".git") continue;
    await deleteContextFilesInDir(path.join(dir, entry.name));
  }
}

/** Returns which of the given repo context paths have uncommitted changes, per `git status --porcelain`. */
async function dirtyContextPaths(repoRoot: string, repoPaths: string[]): Promise<string[]> {
  if (repoPaths.length === 0) return [];
  const status = await gitText(repoRoot, ["status", "--porcelain", "--", ...repoPaths]).catch(() => "");
  return status.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
}

/** Walks up `depth` parent directories from the work parent to locate an ancestor-scoped file's base. */
function ancestorBase(workParent: string, depth: number): string {
  let current = workParent;
  for (let index = 1; index < depth; index += 1) current = path.dirname(current);
  return current;
}

/** Normalizes a cwd to a forward-slash relative path, collapsing "." segments to ".". */
function normalizeCwd(cwd: string): string {
  const normalized = cwd.split(/[\\/]+/).filter((part) => part && part !== ".").join("/");
  return normalized || ".";
}
