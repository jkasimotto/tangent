import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Shared file selection for the size lints, function-size and module-size.
// Both check every production source module of the Agent Shell app and of
// the lint kit, honour the same flags, and print the same report shape. The
// strict scope, the Map and the lint kit, is never grandfathered; the wider
// scope, the rest of the app, keeps a GRANDFATHERED_FILES ratchet per lint.

/** Extensions of the source files the size lints measure. */
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/** Repo-relative directories whose files are never grandfathered. */
const STRICT_SCOPE_DIRECTORIES = ["packages/agent-shell/app/map", "scripts/lint"];

/** Repo-relative directories walked when a lint is given no paths. */
const WIDER_SCOPE_DIRECTORIES = ["packages/agent-shell/app", "scripts/lint"];

/** Directory names that never hold production source. */
const EXCLUDED_DIRECTORIES = new Set(["dist", "node_modules", "test-fixtures"]);

/** Parses the flags every kit lint accepts: --staged, --root <dir>, and explicit paths. */
export function parseLintArgs(argv) {
  const parsed = { root: process.cwd(), staged: false, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staged") {
      parsed.staged = true;
    } else if (arg === "--root") {
      if (argv[index + 1] === undefined) throw new Error("--root needs a directory");
      parsed.root = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      parsed.paths.push(arg);
    }
  }
  return parsed;
}

/** Converts an absolute or root-relative path to the repo-relative, forward-slash form used in reports. */
function toRepoPath(root, filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

/** Returns whether a repo path lies under one of the given repo-relative directories. */
function isUnder(repoPath, directories) {
  return directories.some((directory) => repoPath.startsWith(`${directory}/`));
}

/** Returns whether a repo path is in the strict scope, which the ratchet never covers. */
export function isStrictScope(repoPath) {
  return isUnder(repoPath, STRICT_SCOPE_DIRECTORIES);
}

/** Returns whether a repo path is a production source module inside the lint scopes. */
export function isProductionSource(repoPath) {
  if (!isUnder(repoPath, WIDER_SCOPE_DIRECTORIES)) return false;
  if (repoPath.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  if (/\.test\.[^/]+$/.test(path.basename(repoPath))) return false;
  return SOURCE_EXTENSIONS.has(path.extname(repoPath).toLowerCase());
}

/** Recursively lists the absolute paths of every file under a directory, skipping excluded names. */
function walkFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) found.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      found.push(fullPath);
    }
  }
  return found;
}

/** Lists every file in the wider scope under the root, as repo paths, before production filtering. */
function listWiderScope(root) {
  return WIDER_SCOPE_DIRECTORIES.flatMap((directory) => {
    const absoluteDirectory = path.join(root, directory);
    if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) return [];
    return walkFiles(absoluteDirectory).map((fullPath) => toRepoPath(root, fullPath));
  });
}

/** Lists the staged files that still exist on disk, as repo paths, the way the pre-commit hook sees them. */
function listStaged(root) {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    cwd: root,
    encoding: "utf8"
  });
  return output.split("\0").filter(Boolean).filter((repoPath) => existsSync(path.join(root, repoPath)));
}

/**
 * Selects the production source modules one lint run checks, sorted and
 * without duplicates. Explicit paths win, then --staged, then the whole
 * scope. A path outside the scopes is dropped so the strict and wider rules
 * apply the same way however the lint was invoked.
 */
export function selectProductionSources(parsed) {
  let candidates;
  if (parsed.paths.length > 0) {
    candidates = parsed.paths.map((given) => toRepoPath(parsed.root, given));
  } else if (parsed.staged) {
    candidates = listStaged(parsed.root);
  } else {
    candidates = listWiderScope(parsed.root);
  }
  return [...new Set(candidates.filter(isProductionSource))].sort();
}

/** Returns whether a file is exempt through a lint's ratchet; the strict scope never is, whatever the set holds. */
export function isGrandfathered(repoPath, grandfatheredFiles) {
  return !isStrictScope(repoPath) && grandfatheredFiles.has(repoPath);
}

/** Prints each hit as "<path>:<line>  <reason>" and the remedy, or the pass line, and sets the exit code. */
export function reportLint(name, hits, remedy, fileCount) {
  if (hits.length === 0) {
    console.log(`${name} lint passed (${fileCount} file(s) checked)`);
    return;
  }
  for (const hit of hits) console.error(`${hit.path}:${hit.line}  ${hit.text}`);
  console.error(`${name} lint failed with ${hits.length} hit(s) in ${fileCount} file(s). ${remedy}`);
  process.exitCode = 1;
}
