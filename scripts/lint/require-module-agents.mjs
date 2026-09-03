#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { MAP_SCOPE, isSourceFile, isTestFile, listDirectories, listStagedFiles, parseLintArgs, reportLint, toRepoPath } from "./wider-scope.mjs";

// Enforces the Map rule "A directory with five or more production files carries its own AGENTS.md"
// (app/map/AGENTS.md, and the lint table in docs/design/area-map-rebuild/code.md). A module that
// grows without its guide erodes the ownership map every agent reads before writing there. The
// guide is AGENTS.md; CLAUDE.md is a symlink to it so both agent families read one file. Scope is
// app/map/ only and nothing is grandfathered: the tree is new.

const MIN_FILES = 5;

/** Returns whether a directory entry counts toward the module's size: source or CSS, not a test or a declaration file. */
function isProductionSource(repoPath) {
  if (isTestFile(repoPath) || repoPath.endsWith(".d.ts")) return false;
  return isSourceFile(repoPath) || repoPath.endsWith(".css");
}

/** Counts the production files directly inside one repo-relative directory. */
function countProductionFiles(root, repoDirectory) {
  const absolute = path.join(root, repoDirectory);
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) return 0;
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .filter((entry) => isProductionSource(`${repoDirectory}/${entry.name}`)).length;
}

/** Returns the guide problem of one directory as a hit, or null when it is compliant or under the threshold. */
function guideProblemOf(root, repoDirectory) {
  const count = countProductionFiles(root, repoDirectory);
  if (count < MIN_FILES) return null;
  const agents = path.join(root, repoDirectory, "AGENTS.md");
  const claude = path.join(root, repoDirectory, "CLAUDE.md");
  if (!existsSync(agents)) {
    return { path: repoDirectory, line: 1, text: `holds ${count} production files but no AGENTS.md` };
  }
  if (!existsSync(claude) && !isSymlink(claude)) {
    return { path: repoDirectory, line: 1, text: "has AGENTS.md but no CLAUDE.md symlink (ln -s AGENTS.md CLAUDE.md)" };
  }
  if (!isSymlink(claude) || readlinkSync(claude) !== "AGENTS.md") {
    return { path: repoDirectory, line: 1, text: "CLAUDE.md must be a symlink to AGENTS.md, not a separate file" };
  }
  return null;
}

/** Returns whether a path is a symbolic link, dangling or not. */
function isSymlink(absolute) {
  try {
    return lstatSync(absolute).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Resolves the directories this run checks: explicit paths, staged files' directories, or the whole Map tree. */
function resolveDirectories(args) {
  if (args.paths.length > 0) {
    return uniqueDirectoriesOf(args.root, args.paths.map((filePath) => toRepoPath(args.root, filePath)));
  }
  if (args.staged) {
    return uniqueDirectoriesOf(args.root, listStagedFiles(args.root));
  }
  return MAP_SCOPE.flatMap((dir) => listDirectories(args.root, dir));
}

/** Maps repo paths to the distinct in-scope directories they name or live in. */
function uniqueDirectoriesOf(root, repoPaths) {
  const directories = new Set();
  for (const repoPath of repoPaths) {
    const absolute = path.join(root, repoPath);
    const directory = existsSync(absolute) && lstatSync(absolute).isDirectory() ? repoPath : path.posix.dirname(repoPath);
    if (MAP_SCOPE.some((dir) => directory === dir || directory.startsWith(`${dir}/`))) directories.add(directory);
  }
  return [...directories];
}

/** Runs the require-module-agents lint over the Map tree. */
function main() {
  const args = parseLintArgs(process.argv.slice(2));
  const directories = resolveDirectories(args);
  const hits = directories.map((directory) => guideProblemOf(args.root, directory)).filter(Boolean);
  reportLint(
    "require-module-agents",
    hits,
    `Every directory holding ${MIN_FILES} or more production files carries an AGENTS.md stating its job, with CLAUDE.md a symlink to it.`,
    `${directories.length} director${directories.length === 1 ? "y" : "ies"} checked`
  );
}

main();
