import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import ts from "typescript";
import { parseLintArgs, parseSourceFile, reportLint, toRepoPath } from "./lint-scope.mjs";

// The style scope of the Map lint kit, shared by the four CSS-family lints:
// ui-style-confinement, design-token-confinement, layer-confinement and
// no-freestanding-position. lint-scope.mjs walks script files only; these lints
// also read .css, and they inspect the Map alone because the lint sources under
// scripts/lint/ quote the very patterns they ban. Test files are not UI and are
// skipped. Each lint owns its rule; this module owns where it looks.

export const MAP_ROOT = "packages/agent-shell/app/map/";
export const UI_OWNER = "packages/agent-shell/app/map/ui/";
export const TOKENS_OWNER = "packages/agent-shell/app/map/ui/tokens.css";
export const LAYERS_OWNER = "packages/agent-shell/app/map/ui/layers.css";
export const MAP_ROOT_COMPONENT = "packages/agent-shell/app/map/MapRoot.tsx";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "test-fixtures"]);

/** True when a repository path is a production Map file with one of the given extensions. */
export function isMapStyleFile(repoPath, extensions) {
  if (!repoPath.startsWith(MAP_ROOT)) return false;
  const segments = repoPath.split("/");
  if (segments.some((segment) => SKIPPED_DIRECTORIES.has(segment))) return false;
  const fileName = segments[segments.length - 1];
  if (fileName.includes(".test.")) return false;
  return extensions.has(extname(fileName).toLowerCase());
}

/** Turns absolute paths into lint files, keeping the ones that exist and the predicate accepts. */
function toInspectedFiles(root, absolutePaths, isInspected) {
  return absolutePaths
    .map((absolutePath) => ({ absolutePath, repoPath: toRepoPath(root, absolutePath) }))
    .filter((file) => isInspected(file.repoPath) && existsSync(file.absolutePath) && statSync(file.absolutePath).isFile());
}

/** Lists every file under the Map directory in one recursive read; the predicate drops skipped directories. */
function listScopeFiles(root, isInspected) {
  const scopeDirectory = join(root, ...MAP_ROOT.split("/").filter((segment) => segment.length > 0));
  if (!existsSync(scopeDirectory)) return [];
  const entries = readdirSync(scopeDirectory, { recursive: true }).map((entry) => join(scopeDirectory, String(entry)));
  return toInspectedFiles(root, entries, isInspected);
}

/** Lists the staged files the predicate accepts, the set the pre-commit hook lints. */
function listStagedStyleFiles(root, isInspected) {
  const gitArgs = ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"];
  const staged = execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).split("\0");
  return toInspectedFiles(root, staged.filter((repoPath) => repoPath.length > 0).map((repoPath) => join(root, repoPath)), isInspected);
}

/** Resolves explicit paths against the root and keeps the ones the predicate accepts. */
function listExplicitStyleFiles(root, paths, isInspected) {
  const absolutePaths = paths.map((path) => (isAbsolute(path) ? path : resolve(root, path)));
  return toInspectedFiles(root, absolutePaths, isInspected);
}

/** Lists the files a style lint covers: explicit paths, staged files, or the whole Map. */
export function listStyleFiles({ root, staged, paths }, isInspected) {
  if (paths.length > 0) return listExplicitStyleFiles(root, paths, isInspected);
  if (staged) return listStagedStyleFiles(root, isInspected);
  return listScopeFiles(root, isInspected);
}

/** Runs one style lint end to end: parses the arguments, selects the files, collects the hits and prints the report. */
export function runStyleLint({ name, remedy, isInspected, collectFileHits }) {
  const files = listStyleFiles(parseLintArgs(process.argv.slice(2)), isInspected);
  const hits = files.flatMap(collectFileHits);
  reportLint(name, hits, remedy, files.length);
}

/** Builds a hit with a reason in front of the trimmed source line. */
export function reasonHit(file, line, reason, text) {
  return { repoPath: file.repoPath, line, text: `${reason}: ${text.trim()}` };
}

/** Returns the one-based line on which a node starts. */
export function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** Returns the tag name of a JSX opening or self-closing element, or an empty string for any other node. */
export function jsxTagName(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return "";
}

/** Collects a JSX file's style text: every style= attribute value and every <style> element body, each with its start line. */
export function jsxStyleSegments(file, source) {
  const sourceFile = parseSourceFile(file, source);
  const segments = [];

  /** Records one node's text as a style segment starting at its line. */
  const record = (node) => {
    segments.push({ line: lineOf(sourceFile, node), text: node.getText(sourceFile) });
  };

  /** Walks the tree and records style attributes and style elements. */
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "style" && node.initializer) {
      record(node.initializer);
    }
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === "style") {
      node.children.forEach(record);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return segments;
}

/** Splits a style segment into its lines, each carrying its file line number. */
export function segmentLines(segment) {
  return segment.text.split("\n").map((text, offset) => ({ line: segment.line + offset, text }));
}
