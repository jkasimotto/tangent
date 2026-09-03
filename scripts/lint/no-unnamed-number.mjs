#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Bans unnamed numeric literals in the Map. Every number the Map uses is a
// named unit or layout token, so a reader never has to guess what `16` or
// `960` measures. The only literals allowed everywhere are 0, 1 and -1, plus
// 2 as a direct operand of multiplication or division (midpoints, doubling).
// Every other literal lives in one of the OWNER paths below. The strict scope
// is never grandfathered, so this lint carries no ratchet.

const LINT_NAME = "no-unnamed-number";

// The strict scope: linted in full, no exceptions beyond the owners.
const SCOPE_ROOTS = ["packages/agent-shell/app/map", "scripts/lint"];

// Files and directories whose job is to name numbers. A literal is expected here.
const OWNER_DIRECTORIES = ["packages/agent-shell/app/map/units/"];
const OWNER_FILES = new Set(["packages/agent-shell/app/map/layout/layout-tokens.ts"]);

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "test-fixtures"]);

// Literal values every file may use without naming them.
const FREE_VALUES = new Set([0, 1, -1]);
const HALVING_OR_DOUBLING_VALUE = 2;
const SCALING_OPERATORS = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken
]);

/** Parses the command line into staged mode, the repository root and explicit paths. */
function parseArgs(argv) {
  const parsed = { staged: false, root: process.cwd(), paths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--staged") {
      parsed.staged = true;
    } else if (arg === "--root") {
      i += 1;
      if (!argv[i]) throw new Error("--root needs a directory");
      parsed.root = path.resolve(argv[i]);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      parsed.paths.push(arg);
    }
  }
  return parsed;
}

/** Prints CLI usage for this lint. */
function printUsage() {
  console.log(`Usage:
  node scripts/lint/${LINT_NAME}.mjs [--staged] [--root <dir>] [paths...]

Options:
  --staged      Lint only staged files (git diff --cached --name-only --diff-filter=ACMR).
  --root <dir>  Treat <dir> as the repository root instead of the current directory.
  paths...      Explicit files to lint. Without paths and without --staged the whole scope is linted.`);
}

/** Converts an absolute path into the repo-relative form used in scope checks and diagnostics. */
function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

/** Returns whether a repo-relative path names a test file, which this lint exempts. */
function isTestFile(repoPath) {
  return /\.test\.[^/]+$/.test(path.basename(repoPath));
}

/** Returns whether a repo-relative path is a lintable production source file inside the strict scope. */
function isInScope(repoPath) {
  if (!SCOPE_ROOTS.some((scopeRoot) => repoPath.startsWith(`${scopeRoot}/`))) return false;
  if (repoPath.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment))) return false;
  if (!EXTENSIONS.has(path.extname(repoPath).toLowerCase())) return false;
  return !isTestFile(repoPath);
}

/** Returns whether a repo-relative path is one of the files allowed to hold unnamed numbers. */
function isOwnerFile(repoPath) {
  if (OWNER_FILES.has(repoPath)) return true;
  return OWNER_DIRECTORIES.some((directory) => repoPath.startsWith(directory));
}

/** Recursively lists the files under one directory, skipping build output and fixtures. */
function listFilesUnder(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      result.push(...listFilesUnder(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

/** Lists every in-scope file under the repository root. */
function listScopeFiles(root) {
  return SCOPE_ROOTS.flatMap((scopeRoot) => listFilesUnder(path.join(root, scopeRoot)));
}

/** Lists the staged files, as git reports them relative to the repository root. */
function listStagedFiles(root) {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    cwd: root,
    encoding: "utf8"
  });
  return output.split("\0").filter(Boolean).map((repoPath) => path.join(root, repoPath));
}

/** Resolves explicit command-line paths against the repository root. */
function resolveExplicitPaths(root, paths) {
  return paths.map((candidate) => path.resolve(root, candidate));
}

/** Chooses the candidate files for this run from the parsed arguments. */
function selectCandidateFiles(parsed) {
  if (parsed.paths.length > 0) return resolveExplicitPaths(parsed.root, parsed.paths);
  if (parsed.staged) return listStagedFiles(parsed.root);
  return listScopeFiles(parsed.root);
}

/** Keeps only the candidates that exist, sit inside the strict scope, and are not owners. */
function selectLintedFiles(root, candidates) {
  return candidates.filter((absolutePath) => {
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return false;
    const repoPath = toRepoPath(root, absolutePath);
    return isInScope(repoPath) && !isOwnerFile(repoPath);
  });
}

/** Maps a file extension to the TypeScript parser script kind. */
function scriptKindFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Returns the numeric value of a numeric or bigint literal node, honouring separators and radix prefixes. */
function literalValue(node) {
  const text = node.text.replace(/_/g, "").replace(/n$/, "");
  return Number(text);
}

/** Returns the signed value of a literal, folding a directly enclosing unary minus into it. */
function signedLiteralValue(node) {
  const value = literalValue(node);
  const parent = node.parent;
  if (parent && ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.MinusToken) {
    return -value;
  }
  return value;
}

/** Returns whether a literal is the 2 in a halving or doubling, a direct operand of `*` or `/`. */
function isHalvingOrDoubling(node) {
  if (literalValue(node) !== HALVING_OR_DOUBLING_VALUE) return false;
  const parent = node.parent;
  return Boolean(parent) && ts.isBinaryExpression(parent) && SCALING_OPERATORS.has(parent.operatorToken.kind);
}

/** Returns whether a literal node is one every file may hold without naming it. */
function isAllowedLiteral(node) {
  return FREE_VALUES.has(signedLiteralValue(node)) || isHalvingOrDoubling(node);
}

/** Returns whether a node is a numeric literal in the sense of this lint. */
function isNumberLiteral(node) {
  return ts.isNumericLiteral(node) || ts.isBigIntLiteral(node);
}

/** Collects every unnamed numeric literal in one file as `{ file, line, text }` hits. */
function collectUnnamedNumbers(root, absolutePath) {
  const repoPath = toRepoPath(root, absolutePath);
  const source = readFileSync(absolutePath, "utf8");
  const lines = source.split("\n");
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(absolutePath));
  const hits = [];

  /** Visits one node and records it when it is a banned literal, then descends. */
  const visit = (node) => {
    if (isNumberLiteral(node) && !isAllowedLiteral(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hits.push({ file: repoPath, line: line + 1, text: (lines[line] ?? "").trim() });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return hits;
}

/** Prints the hits and the remedy, and sets the failing exit code. */
function reportFailure(hits) {
  for (const hit of hits) console.error(`${hit.file}:${hit.line}  ${hit.text}`);
  console.error(
    `${LINT_NAME} lint failed with ${hits.length} unnamed number(s). Name each one as a unit in packages/agent-shell/app/map/units/ or a layout token in packages/agent-shell/app/map/layout/layout-tokens.ts and use the name here.`
  );
  process.exitCode = 1;
}

/** Runs the lint over the selected files and reports the outcome. */
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const files = selectLintedFiles(parsed.root, selectCandidateFiles(parsed));
  const hits = files.flatMap((file) => collectUnnamedNumbers(parsed.root, file));
  if (hits.length > 0) {
    reportFailure(hits);
    return;
  }
  console.log(`${LINT_NAME} lint passed (${files.length} file(s) checked).`);
}

main();
