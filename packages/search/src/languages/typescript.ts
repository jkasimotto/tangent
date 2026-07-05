import path from "node:path";
import { pathExists } from "@tangent/repo";

import {
  computeLineDepths,
  depthAtLine,
  findMatchingBrace,
  getDocBefore,
  lineStarts,
  posToLine,
  readTextLossy,
  relpath,
  singleLineSignature,
  stripCommentsAndStrings
} from "../core/helpers.js";
import { BaseLanguageAdapter, type LanguageContext, type ParsedFile, type ParsedImport, type ParsedSymbol } from "./base.js";

type IndexedMatch = RegExpExecArray & { index: number };

const tsKeywords = new Set([
  "abstract",
  "any",
  "as",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unknown",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

const callNoise = new Set(["if", "for", "while", "switch", "catch", "return", "throw", "await", "yield", "new", "typeof", "instanceof", "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "console", "require"]);
const primitiveTypes = new Set(["string", "number", "boolean", "object", "any", "unknown", "never", "void", "undefined", "null", "Array", "Promise", "Record", "Readonly", "Partial", "Required", "Pick", "Omit", "Map", "Set"]);

const importFromRe = /^\s*(?<kind>import|export)\b[^;\n]*?\bfrom\s+['"](?<uri>[^'"]+)['"]/gms;
const importSideEffectRe = /^\s*import\s+['"](?<uri>[^'"]+)['"]/gms;
const requireRe = /\brequire\s*\(\s*['"](?<uri>[^'"]+)['"]\s*\)/g;
const dynamicImportRe = /\bimport\s*\(\s*['"](?<uri>[^'"]+)['"]\s*\)/g;
const classRe = /^\s*(?:export\s+default\s+|export\s+)?(?:abstract\s+)?(?<kind>class|interface)\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\b[^;{]*\{/gms;
const enumRe = /^\s*(?:export\s+)?(?:const\s+)?enum\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\b[^;{]*\{/gms;
const typeAliasRe = /^\s*(?:export\s+)?type\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\b[^=]*=\s*(?<body>.*?);/gms;
const functionRe = /^\s*(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^;{}()]*>)?\s*\([^;{}]*?\)\s*(?::\s*[^;{}=]+)?\s*(?<term>\{|;)/gms;
const constFunctionRe = /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=;]+)?=\s*(?:async\s*)?(?:<[^;{}()]*>\s*)?\([^;{}]*?\)\s*(?::\s*[^=;{}]+)?\s*=>\s*(?<term>\{|[^;\n]+;)/gms;
const constValueRe = /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\b/gm;
const methodRe = /^\s*(?:(?:public|private|protected|static|async|override|readonly)\s+)*(?<name>[A-Za-z_$][A-Za-z0-9_$]*|constructor|get\s+[A-Za-z_$][A-Za-z0-9_$]*|set\s+[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^;{}()]*>)?\s*\([^;{}]*?\)\s*(?::\s*[^;{}=]+)?\s*(?<term>\{|;)/gms;
const callRe = /(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^;{}()]*>)?\s*\(/g;
const typeTokenRe = /\b([A-Z][A-Za-z0-9_$]*)\b/g;

export class TypeScriptAdapter extends BaseLanguageAdapter {
  id = "typescript" as const;
  displayName = "TypeScript/JavaScript";
  extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
  generatedSuffixes = [".d.ts", ".generated.ts", ".generated.tsx", ".gen.ts", ".gen.tsx", ".graphql.ts", ".pb.ts"] as const;
  ignoredDirs = ["node_modules", ".next", ".nuxt", ".turbo", "dist", "out", "coverage"] as const;
  classLikeKinds = new Set(["class", "interface", "enum", "type"]);
  functionLikeKinds = new Set(["function", "method", "constructor", "getter", "setter", "arrow_function"]);

  /** Creates context. */
  async createContext(root: string): Promise<LanguageContext> {
    return { root, packages: await discoverPackages(root), tsconfig: await loadTsconfig(root) };
  }

  /** Returns whether generated path. */
  override isGeneratedPath(relPath: string): boolean {
    const lower = relPath.toLowerCase();
    return lower.endsWith(".d.ts") || ["/__generated__/", "/generated/", "/gen/"].some((segment) => lower.includes(segment)) || this.generatedSuffixes.some((suffix) => lower.endsWith(suffix));
  }

  /** Returns whether test path. */
  override isTestPath(relPath: string): boolean {
    const lower = relPath.toLowerCase();
    return lower.includes("/__tests__/") || lower.startsWith("test/") || lower.startsWith("tests/") || lower.includes("/test/") || lower.includes("/tests/") || [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".test.js", ".spec.js", ".test.jsx", ".spec.jsx"].some((suffix) => lower.endsWith(suffix));
  }

  /** Parses file. */
  async parseFile(filePath: string, root: string, context: LanguageContext): Promise<ParsedFile> {
    const rel = relpath(filePath, root);
    const text = await readTextLossy(filePath);
    const clean = stripCommentsAndStrings(text);
    const starts = lineStarts(text);
    const depths = computeLineDepths(clean);
    const lines = text.split(/\r?\n/);
    const parsed: ParsedFile = {
      language: this.id,
      path: rel,
      absolutePath: filePath,
      isTest: this.isTestPath(rel),
      isGenerated: this.isGeneratedPath(rel),
      packageName: packageForFile(filePath, root, context.packages),
      imports: [],
      symbols: [],
      cleanSource: clean,
      lineStarts: starts
    };

    for (const { regex, kindName } of [
      { regex: importFromRe, kindName: undefined },
      { regex: importSideEffectRe, kindName: "import" },
      { regex: requireRe, kindName: "require" },
      { regex: dynamicImportRe, kindName: "dynamic_import" }
    ]) {
      regex.lastIndex = 0;
      for (const match of matchAllReset(clean, regex)) {
        const uri = match.groups?.uri;
        if (!uri) continue;
        const kind = match.groups?.kind || kindName || "import";
        parsed.imports.push({ kind, uri, line: posToLine(starts, match.index), resolvedPath: await resolveUri(uri, filePath, root, context, this.extensions) });
      }
    }

    let temp = 1;
    const classRanges: ParsedSymbol[] = [];
    /** Adds block. */
    const addBlock = (kind: string, name: string, match: IndexedMatch): ParsedSymbol | undefined => {
      const startLine = posToLine(starts, match.index);
      const openBracePos = clean.indexOf("{", match.index);
      if (openBracePos < 0) return undefined;
      const closeBracePos = findMatchingBrace(clean, openBracePos);
      const endLine = closeBracePos === undefined ? startLine : posToLine(starts, closeBracePos);
      const symbol: ParsedSymbol = {
        tempId: temp++,
        name,
        qualifiedName: name,
        kind,
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine,
        signature: singleLineSignature(text.slice(match.index, openBracePos + 1)),
        doc: getDocBefore(lines, startLine),
        openBracePos,
        closeBracePos,
        startPos: match.index,
        endPos: closeBracePos ?? openBracePos
      };
      parsed.symbols.push(symbol);
      return symbol;
    };

    for (const match of matchAllReset(clean, classRe)) {
      const symbol = addBlock(match.groups?.kind || "class", match.groups?.name || "", match);
      if (symbol) classRanges.push(symbol);
    }
    for (const match of matchAllReset(clean, enumRe)) {
      const symbol = addBlock("enum", match.groups?.name || "", match);
      if (symbol) classRanges.push(symbol);
    }
    classRanges.sort((a, b) => a.startPos - b.startPos || b.endPos - a.endPos);

    /** Supports the parent for helper. */
    const parentFor = (startPos: number): ParsedSymbol | undefined => {
      const candidates = classRanges.filter((symbol) => symbol.openBracePos !== undefined && symbol.closeBracePos !== undefined && symbol.openBracePos < startPos && startPos < symbol.closeBracePos);
      return candidates.sort((a, b) => (b.openBracePos || 0) - (a.openBracePos || 0))[0];
    };
    /** Supports the valid depth helper. */
    const validDepth = (startLine: number, parent: ParsedSymbol | undefined): boolean => {
      const depth = depthAtLine(depths, startLine);
      return parent ? depth === depthAtLine(depths, parent.startLine) + 1 : depth === 0;
    };

    const used = new Set(classRanges.map((symbol) => symbol.startLine));
    for (const match of matchAllReset(clean, typeAliasRe)) {
      const startLine = posToLine(starts, match.index);
      if (depthAtLine(depths, startLine) !== 0) continue;
      const name = match.groups?.name || "";
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: name,
        kind: "type",
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: posToLine(starts, match.index + match[0].length),
        signature: singleLineSignature(text.slice(match.index, match.index + match[0].length)),
        doc: getDocBefore(lines, startLine),
        startPos: match.index,
        endPos: match.index + match[0].length
      });
    }

    for (const match of matchAllReset(clean, functionRe)) {
      const startLine = posToLine(starts, match.index);
      if (used.has(startLine) || depthAtLine(depths, startLine) !== 0) continue;
      const name = match.groups?.name || "";
      if (tsKeywords.has(name)) continue;
      const term = match.groups?.term || "";
      const termPos = match.index + match[0].lastIndexOf(term);
      const closeBracePos = term === "{" ? findMatchingBrace(clean, termPos) : undefined;
      parsed.symbols.push(blockSymbol({ temp: temp++, name, kind: "function", text, lines, starts, match, termPos, closeBracePos }));
    }

    for (const match of matchAllReset(clean, constFunctionRe)) {
      const startLine = posToLine(starts, match.index);
      if (depthAtLine(depths, startLine) !== 0) continue;
      const name = match.groups?.name || "";
      const term = match.groups?.term || "";
      const termPos = match.index + match[0].lastIndexOf(term);
      const closeBracePos = term === "{" ? findMatchingBrace(clean, termPos) : undefined;
      parsed.symbols.push(blockSymbol({ temp: temp++, name, kind: "arrow_function", text, lines, starts, match, termPos, closeBracePos }));
    }

    for (const match of matchAllReset(clean, methodRe)) {
      const startLine = posToLine(starts, match.index);
      const parent = parentFor(match.index);
      if (!parent || !validDepth(startLine, parent)) continue;
      const raw = (match.groups?.name || "").trim();
      let kind = "method";
      let name = raw;
      if (raw === "constructor") kind = "constructor";
      else if (raw.startsWith("get ")) {
        name = raw.split(/\s+/, 2)[1] || raw;
        kind = "getter";
      } else if (raw.startsWith("set ")) {
        name = raw.split(/\s+/, 2)[1] || raw;
        kind = "setter";
      }
      if (name !== "constructor" && tsKeywords.has(name)) continue;
      const term = match.groups?.term || "";
      const termPos = match.index + match[0].lastIndexOf(term);
      const closeBracePos = term === "{" ? findMatchingBrace(clean, termPos) : undefined;
      parsed.symbols.push(blockSymbol({ temp: temp++, name, kind, qualifiedName: `${parent.name}.${name}`, parentTempId: parent.tempId, text, lines, starts, match, termPos, closeBracePos }));
    }

    const occupied = new Set(parsed.symbols.map((symbol) => symbol.startLine));
    for (const match of matchAllReset(clean, constValueRe)) {
      const startLine = posToLine(starts, match.index);
      if (occupied.has(startLine) || depthAtLine(depths, startLine) !== 0) continue;
      const name = match.groups?.name || "";
      if (tsKeywords.has(name)) continue;
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: name,
        kind: "variable",
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: startLine,
        signature: singleLineSignature(lines[startLine - 1] || name),
        doc: getDocBefore(lines, startLine),
        startPos: match.index,
        endPos: match.index + match[0].length
      });
    }

    parsed.symbols.sort((a, b) => a.startLine - b.startLine || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    return parsed;
  }

  /** Supports the call names helper. */
  *callNames(text: string): Iterable<string> {
    for (const match of text.matchAll(callRe)) {
      const name = match[1]!;
      if (!tsKeywords.has(name) && !callNoise.has(name)) yield name;
    }
  }

  /** Supports the type names helper. */
  *typeNames(text: string): Iterable<string> {
    for (const match of text.matchAll(typeTokenRe)) {
      const name = match[1]!;
      if (!primitiveTypes.has(name) && !tsKeywords.has(name)) yield name;
    }
  }
}

/** Supports the block symbol helper. */
function blockSymbol(options: {
  temp: number;
  name: string;
  kind: string;
  qualifiedName?: string;
  parentTempId?: number;
  text: string;
  lines: readonly string[];
  starts: readonly number[];
  match: IndexedMatch;
  termPos: number;
  closeBracePos?: number;
}): ParsedSymbol {
  const startLine = posToLine(options.starts, options.match.index);
  const endPos = options.closeBracePos ?? options.match.index + options.match[0].length;
  return {
    tempId: options.temp,
    name: options.name,
    qualifiedName: options.qualifiedName || options.name,
    kind: options.kind,
    visibility: options.name.startsWith("#") || options.name.startsWith("_") ? "private" : "public",
    startLine,
    endLine: posToLine(options.starts, endPos),
    signature: singleLineSignature(options.text.slice(options.match.index, options.termPos)),
    doc: getDocBefore(options.lines, startLine),
    parentTempId: options.parentTempId,
    openBracePos: options.closeBracePos === undefined ? undefined : options.termPos,
    closeBracePos: options.closeBracePos,
    startPos: options.match.index,
    endPos
  };
}

/** Discovers packages. */
async function discoverPackages(root: string): Promise<Record<string, string>> {
  const packages: Record<string, string> = {};
  const candidates = [path.join(root, "package.json")];
  await collectPackageJson(root, candidates);
  for (const candidate of candidates) {
    const data = await loadJsonLenient(candidate);
    const name = data.name;
    if (typeof name === "string") packages[name] = relpath(path.dirname(candidate), root);
  }
  return packages;
}

/** Collects package json. */
async function collectPackageJson(dir: string, out: string[]): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || ["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
    const child = path.join(dir, entry.name);
    const packagePath = path.join(child, "package.json");
    if (await pathExists(packagePath)) out.push(packagePath);
    await collectPackageJson(child, out);
  }
}

/** Loads tsconfig. */
async function loadTsconfig(root: string): Promise<Record<string, unknown>> {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(root, name);
    if (await pathExists(configPath)) {
      const data = await loadJsonLenient(configPath);
      return isObject(data.compilerOptions) ? data.compilerOptions : {};
    }
  }
  return {};
}

/** Loads json lenient. */
async function loadJsonLenient(filePath: string): Promise<Record<string, unknown>> {
  try {
    const text = (await readTextLossy(filePath)).replace(/\/\/.*$/gm, "").replace(/\/\*.*?\*\//gs, "").replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Resolves uri. */
async function resolveUri(uri: string, currentFile: string, root: string, context: LanguageContext, extensions: readonly string[]): Promise<string | undefined> {
  if (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("node:")) return undefined;
  if (uri.startsWith(".")) return resolveFileCandidate(path.resolve(path.dirname(currentFile), uri), root, extensions);
  const alias = await resolveTsPathAlias(uri, root, context.tsconfig, extensions);
  if (alias) return alias;
  for (const [packageName, packageRoot] of Object.entries(context.packages).sort((a, b) => b[0].length - a[0].length)) {
    if (uri === packageName) {
      for (const sub of ["src/index", "index"]) {
        const resolved = await resolveFileCandidate(path.join(root, packageRoot, sub), root, extensions);
        if (resolved) return resolved;
      }
    }
    if (uri.startsWith(`${packageName}/`)) {
      const rest = uri.slice(packageName.length + 1);
      for (const prefix of ["src", "lib", ""]) {
        const resolved = await resolveFileCandidate(path.join(root, packageRoot, prefix, rest), root, extensions);
        if (resolved) return resolved;
      }
    }
  }
  return undefined;
}

/** Resolves ts path alias. */
async function resolveTsPathAlias(uri: string, root: string, tsconfig: Record<string, unknown>, extensions: readonly string[]): Promise<string | undefined> {
  const baseUrl = typeof tsconfig.baseUrl === "string" ? tsconfig.baseUrl : ".";
  const base = path.resolve(root, baseUrl);
  const paths = isObject(tsconfig.paths) ? tsconfig.paths : undefined;
  if (paths) {
    for (const [pattern, rawTargets] of Object.entries(paths)) {
      const targets = Array.isArray(rawTargets) ? rawTargets : [];
      if (pattern.includes("*")) {
        const [pre, post = ""] = pattern.split("*", 2);
        if (uri.startsWith(pre || "") && uri.endsWith(post)) {
          const middle = uri.slice((pre || "").length, post ? -post.length : undefined);
          for (const target of targets) {
            if (typeof target !== "string") continue;
            const resolved = await resolveFileCandidate(path.join(base, target.replace("*", middle)), root, extensions);
            if (resolved) return resolved;
          }
        }
      } else if (uri === pattern) {
        for (const target of targets) {
          if (typeof target !== "string") continue;
          const resolved = await resolveFileCandidate(path.join(base, target), root, extensions);
          if (resolved) return resolved;
        }
      }
    }
  }
  return resolveFileCandidate(path.join(base, uri), root, extensions);
}

/** Resolves file candidate. */
async function resolveFileCandidate(base: string, root: string, extensions: readonly string[]): Promise<string | undefined> {
  const candidates: string[] = [];
  if (extensions.includes(path.extname(base))) candidates.push(base);
  else {
    for (const extension of extensions) candidates.push(`${base}${extension}`);
    for (const extension of extensions) candidates.push(path.join(base, `index${extension}`));
  }
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return relpath(candidate, root);
  }
  return undefined;
}

/** Supports the package for file helper. */
function packageForFile(filePath: string, root: string, packages: Record<string, string>): string | undefined {
  const relative = relpath(filePath, root);
  let best: { length: number; name: string } | undefined;
  for (const [name, packageRoot] of Object.entries(packages)) {
    const prefix = `${packageRoot.replace(/\/$/, "")}/`;
    if (relative === packageRoot || relative.startsWith(prefix)) {
      if (!best || prefix.length > best.length) best = { length: prefix.length, name };
    }
  }
  return best?.name;
}

/** Matches a all reset. */
function matchAllReset(text: string, regex: RegExp): IndexedMatch[] {
  regex.lastIndex = 0;
  return [...text.matchAll(regex)].filter((match): match is IndexedMatch => match.index !== undefined);
}

/** Returns whether object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
