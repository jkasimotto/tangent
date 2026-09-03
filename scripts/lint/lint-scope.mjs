import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

// Shared scaffold for the Map lint kit: argument parsing, the strict scope walk, staged file
// discovery, TypeScript parsing and the one report shape every lint prints. Each lint owns its
// rule; this module owns where the rule looks and how a hit is printed.

/** The directories whose production files are always linted and never grandfathered. */
export const STRICT_SCOPE_ROOTS = ["packages/agent-shell/app/map", "scripts/lint"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "test-fixtures"]);

/** Parses the flags every lint accepts: --staged, --root <dir>, and explicit paths. */
export function parseLintArgs(argv) {
  const parsed = { root: process.cwd(), staged: false, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staged") {
      parsed.staged = true;
    } else if (arg === "--root") {
      parsed.root = resolve(argv[index + 1] ?? process.cwd());
      index += 1;
    } else {
      parsed.paths.push(arg);
    }
  }
  return parsed;
}

/** Converts an absolute path to the forward-slash repository-relative form used in diagnostics. */
export function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

/** True when a repository path is a production source file inside the strict scope. */
export function isStrictScopeFile(repoPath) {
  if (!STRICT_SCOPE_ROOTS.some((scopeRoot) => repoPath.startsWith(`${scopeRoot}/`))) return false;
  const segments = repoPath.split("/");
  if (segments.some((segment) => SKIPPED_DIRECTORIES.has(segment))) return false;
  const fileName = segments[segments.length - 1];
  if (fileName.includes(".test.") || fileName.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

/** Recursively lists every strict-scope production file under one directory. */
function walkScopeDirectory(root, directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...walkScopeDirectory(root, absolutePath));
      continue;
    }
    const repoPath = toRepoPath(root, absolutePath);
    if (isStrictScopeFile(repoPath)) files.push({ absolutePath, repoPath });
  }
  return files;
}

/** Lists the staged strict-scope files, the set the pre-commit hook lints. */
function listStagedFiles(root) {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    cwd: root,
    encoding: "utf8"
  });
  return output
    .split("\0")
    .filter((repoPath) => repoPath.length > 0 && isStrictScopeFile(repoPath))
    .map((repoPath) => ({ absolutePath: join(root, repoPath), repoPath }))
    .filter((file) => existsSync(file.absolutePath));
}

/** Resolves explicit command-line paths against the root; they are linted as given. */
function listExplicitFiles(root, paths) {
  return paths.map((path) => {
    const absolutePath = isAbsolute(path) ? path : resolve(root, path);
    return { absolutePath, repoPath: toRepoPath(root, absolutePath) };
  });
}

/** Lists the files a lint run covers: explicit paths, staged files, or the whole strict scope. */
export function listLintFiles({ root, staged, paths }) {
  if (paths.length > 0) return listExplicitFiles(root, paths);
  if (staged) return listStagedFiles(root);
  return STRICT_SCOPE_ROOTS.flatMap((scopeRoot) => walkScopeDirectory(root, join(root, scopeRoot)));
}

/** Maps a file extension to the TypeScript parser script kind so JSX in .tsx and .jsx parses. */
function scriptKindFor(repoPath) {
  const extension = extname(repoPath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Parses one source file into a TypeScript AST with parent pointers set. */
export function parseSourceFile(file, source) {
  return ts.createSourceFile(file.repoPath, source, ts.ScriptTarget.Latest, true, scriptKindFor(file.repoPath));
}

/** Builds a hit for one node: the file, its one-based line, and the trimmed source line. */
export function hitFor(sourceFile, file, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const text = sourceFile.text.split("\n")[line] ?? "";
  return { repoPath: file.repoPath, line: line + 1, text: text.trim() };
}

/** Walks every node of a source file and collects the hits a matcher reports. */
export function collectHits(sourceFile, file, matcher) {
  const hits = [];
  /** Visits one node, records it when the matcher accepts it, then descends. */
  const visit = (node) => {
    if (matcher(node)) hits.push(hitFor(sourceFile, file, node));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

/** Returns the text of a string literal or plain template literal node, or null otherwise. */
export function literalText(node) {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Returns the literal event name of an addEventListener call on any receiver, or null. */
export function listenerEventName(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const isDirect = ts.isIdentifier(callee) && callee.text === "addEventListener";
  const isMember = ts.isPropertyAccessExpression(callee) && callee.name.text === "addEventListener";
  if (!isDirect && !isMember) return null;
  return literalText(node.arguments[0]);
}

/** Returns the name of a JSX attribute node, or null for any other node. */
export function jsxAttributeName(node) {
  if (!ts.isJsxAttribute(node)) return null;
  return ts.isIdentifier(node.name) ? node.name.text : node.name.getText();
}

/** Prints the shared report shape and sets the exit code: hits and a remedy, or one pass line. */
export function reportLint(name, hits, remedy, fileCount) {
  if (hits.length > 0) {
    for (const hit of hits) console.error(`${hit.repoPath}:${hit.line}  ${hit.text}`);
    console.error(`${name} lint failed with ${hits.length} hit(s) in ${fileCount} file(s). ${remedy}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${name} lint passed (${fileCount} file(s) checked)`);
}
