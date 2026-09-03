import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { listStagedRepoPaths, parseLintArgs, toRepoPath } from "./lint-scope.mjs";

// The wider scope of the Map lint kit: every production file under packages/agent-shell/app,
// public/ included, where offenders at introduction live in a GRANDFATHERED_FILES ratchet. The
// lints that cover it (no-long-param-list, no-junk-drawer-modules) and the Map-only directory lint
// (require-module-agents) share their file selection and report shape here so each script holds
// only its rule. Argument parsing, path conversion and the staged listing come from lint-scope.mjs.

export { parseLintArgs, toRepoPath, listStagedRepoPaths as listStagedFiles };

/** Extensions of files the AST lints parse. */
export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/** The wider scope plus the lint kit itself, repo-relative and without a trailing slash. */
export const WIDER_SCOPE = ["packages/agent-shell/app", "scripts/lint"];

/** The Map tree, the one directory tree require-module-agents covers. */
export const MAP_SCOPE = ["packages/agent-shell/app/map"];

/** Directory names that never hold production source. */
const EXCLUDED_DIRECTORIES = new Set(["dist", "node_modules", "test-fixtures"]);

/** Returns whether a repo path names a test file, by the ".test." marker in its basename. */
export function isTestFile(repoPath) {
  return path.basename(repoPath).includes(".test.");
}

/** Returns whether a repo path passes through a build, dependency or fixture directory. */
export function isExcludedPath(repoPath) {
  return repoPath.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

/** Returns whether a repo path lies under one of the given scope directories. */
export function isInScope(repoPath, scopeDirectories) {
  return scopeDirectories.some((dir) => repoPath === dir || repoPath.startsWith(`${dir}/`));
}

/** Returns whether a repo path is a production file the lints may look at. */
export function isProductionPath(repoPath, scopeDirectories) {
  return isInScope(repoPath, scopeDirectories) && !isExcludedPath(repoPath) && !isTestFile(repoPath);
}

/** Returns whether a repo path has an extension the AST lints parse. */
export function isSourceFile(repoPath) {
  return SOURCE_EXTENSIONS.has(path.extname(repoPath).toLowerCase());
}

/** Recursively lists every directory under a repo-relative directory, itself included, skipping excluded names. */
export function listDirectories(root, repoDirectory) {
  const absolute = path.join(root, repoDirectory);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return [];
  const result = [repoDirectory];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    result.push(...listDirectories(root, `${repoDirectory}/${entry.name}`));
  }
  return result;
}

/** Lists the repo paths of every production file directly inside one repo-relative directory. */
export function listDirectFiles(root, repoDirectory) {
  const absolute = path.join(root, repoDirectory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => `${repoDirectory}/${entry.name}`)
    .filter((repoPath) => !isTestFile(repoPath));
}

/** Lists every production file under the given scope directories. */
export function listScopeFiles(root, scopeDirectories) {
  return scopeDirectories.flatMap((scopeDirectory) =>
    listDirectories(root, scopeDirectory).flatMap((directory) => listDirectFiles(root, directory))
  );
}

/** Resolves the production files a lint run covers from its parsed arguments and scope. */
export function resolveLintFiles(args, scopeDirectories) {
  let candidates;
  if (args.paths.length > 0) {
    candidates = args.paths.map((filePath) => toRepoPath(args.root, filePath));
  } else if (args.staged) {
    candidates = listStagedRepoPaths(args.root);
  } else {
    candidates = listScopeFiles(args.root, scopeDirectories);
  }
  return candidates.filter((repoPath) => isProductionPath(repoPath, scopeDirectories));
}

/** Prints hits as "<path>:<line>  <reason>" plus the remedy and sets the failing exit code; prints the pass line otherwise. */
export function reportLint(name, hits, remedy, passDetail) {
  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(`${hit.path}:${hit.line}  ${hit.text}`);
    }
    console.error(`${name} lint failed with ${hits.length} hit(s). ${remedy}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${name} lint passed (${passDetail})`);
}
