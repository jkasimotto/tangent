#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const TARGET_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.ConstructorDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression
]);

/** Parses command-line flags for the docstring lint. */
function parseArgs(argv) {
  const parsed = {
    staged: false,
    all: false,
    paths: []
  };

  for (const arg of argv) {
    if (arg === "--staged") {
      parsed.staged = true;
      continue;
    }
    if (arg === "--all") {
      parsed.all = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    parsed.paths.push(arg);
  }

  return parsed;
}

/** Prints CLI usage for the docstring lint. */
function printUsage() {
  console.log(`Usage:
  node scripts/lint-function-docstrings.mjs [--staged] [--all] [paths...]

Options:
  --staged    Check only staged files (git diff --cached --name-only).
  --all       Check all tracked .ts/.js/.jsx/.mjs/.cjs/.tsx files.
  paths...    Optional explicit paths to check.`);
}

/** Runs git and returns non-empty output lines. */
function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Lists staged source paths that should be checked. */
function getDiffFiles() {
  return runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
}

/** Lists all tracked source paths that can be checked. */
function getTrackedSourceFiles() {
  return runGit(["ls-files"]).filter(isTargetFile);
}

/** Returns whether a path is a lintable source file. */
function isTargetFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/dist/") || normalized.includes("/node_modules/") || normalized === "dist") {
    return false;
  }
  const ext = path.extname(normalized).toLowerCase();
  return EXTENSIONS.has(ext);
}

/** Maps a source path to the TypeScript parser script kind. */
function getScriptKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Returns whether TypeScript attached JSDoc to a node. */
function hasJsDoc(node) {
  return Boolean(node.jsDoc && node.jsDoc.length > 0);
}

/** Finds the declaration node that can carry docs for an expression function. */
function owningDocCarrier(node) {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return undefined;
  }

  const parent = node.parent;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isShorthandPropertyAssignment(parent)
  ) {
    return parent;
  }
  return undefined;
}

/** Returns whether a function or its owning declaration has docs. */
function hasDocstringForFunction(node) {
  if (hasJsDoc(node)) return true;

  const carrier = owningDocCarrier(node);
  if (!carrier) return false;
  if (hasJsDoc(carrier)) return true;
  if (
    ts.isVariableDeclaration(carrier) &&
    ts.isVariableDeclarationList(carrier.parent) &&
    ts.isVariableStatement(carrier.parent.parent)
  ) {
    return hasJsDoc(carrier.parent.parent);
  }
  return false;
}

/** Returns a readable name for a linted function node. */
function functionNameForNode(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    if (!node.name) return "anonymous";
    return node.name.getText();
  }

  if (ts.isVariableDeclaration(node.parent)) {
    return node.parent.name.getText();
  }
  if (ts.isPropertyDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isShorthandPropertyAssignment(node.parent)) {
    return node.parent.name.getText();
  }
  return "anonymous";
}

/** Returns whether a node is a function shape covered by this lint. */
function isFunctionCandidate(node) {
  if (!TARGET_KINDS.has(node.kind)) return false;

  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  ) {
    return true;
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return Boolean(owningDocCarrier(node));
  }

  return false;
}

/** Analyzes a single source file for undocumented functions. */
async function analyzeFile(filePath) {
  const sourceText = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );

  const issues = [];

  /** Visits AST nodes and records missing-doc findings. */
  const visit = (node) => {
    if (isFunctionCandidate(node) && !hasDocstringForFunction(node)) {
      const name = functionNameForNode(node);
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      issues.push(`${filePath}:${line + 1}: missing JSDoc on function '${name}'`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return issues;
}

/** Runs the docstring lint command. */
async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  let filesToCheck;

  if (parsed.paths.length > 0) {
    filesToCheck = parsed.paths;
  } else if (parsed.staged) {
    filesToCheck = getDiffFiles();
  } else if (parsed.all) {
    filesToCheck = getTrackedSourceFiles();
  } else {
    filesToCheck = getDiffFiles();
  }

  const checkFiles = filesToCheck.filter(isTargetFile);
  if (checkFiles.length === 0) {
    process.exit(0);
  }

  const issueGroups = await Promise.all(checkFiles.map((filePath) => analyzeFile(filePath)));
  const issues = issueGroups.flat();

  if (issues.length > 0) {
    console.error("Function docstring lint failed:");
    for (const issue of issues) {
      console.error(`  ${issue}`);
    }
    process.exit(1);
  }
}

await main();
