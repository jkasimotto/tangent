import path from "node:path";
import { pathExists } from "@tangent/repo";

import {
  computeLineDepths,
  computeLineParenDepths,
  depthAtLine,
  findMatchingBrace,
  getDocBefore,
  gitLsFiles,
  lineStarts,
  posToLine,
  readTextLossy,
  relpath,
  singleLineSignature,
  stripCommentsAndStrings
} from "../core/helpers.js";
import { BaseLanguageAdapter, type LanguageContext, type ParsedFile, type ParsedSymbol } from "./base.js";

type IndexedMatch = RegExpExecArray & { index: number };

const dartKeywords = new Set(["abstract", "as", "assert", "async", "await", "base", "break", "case", "catch", "class", "const", "continue", "covariant", "default", "deferred", "do", "dynamic", "else", "enum", "export", "extends", "extension", "external", "factory", "false", "final", "finally", "for", "Function", "get", "hide", "if", "implements", "import", "in", "interface", "is", "late", "library", "mixin", "new", "null", "of", "on", "operator", "part", "required", "rethrow", "return", "sealed", "set", "show", "static", "super", "switch", "sync", "this", "throw", "true", "try", "typedef", "var", "void", "when", "while", "with", "yield"]);
const callNoise = new Set(["if", "for", "while", "switch", "catch", "assert", "return", "throw", "await", "yield", "print", "expect", "group", "test", "setUp", "tearDown", "main"]);
const primitiveTypes = new Set(["int", "double", "num", "String", "bool", "Object", "dynamic", "void", "Null", "List", "Map", "Set", "Iterable", "Future", "Stream", "Duration", "DateTime"]);

const classRe = /^[ \t]*(?:(?:abstract|base|interface|final|sealed)\s+)*(?<kind>class|mixin|enum)\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\b[^;{]*\{/gms;
const extensionRe = /^[ \t]*extension(?:\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*))?\s+on\s+[^;{]+\{/gms;
const typedefRe = /^[ \t]*typedef\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\b[^;]*;/gm;
const importRe = /^[ \t]*(?<kind>import|export|part)\s+['"](?<uri>[^'"]+)['"]/gm;
const libraryRe = /^[ \t]*library\s+([^;]+);/m;
const callableDeclRe = /^[ \t]*(?:(?:@[A-Za-z_$][A-Za-z0-9_$.]*(?:\([^\n]*?\))?[ \t]*\n[ \t]*)*)(?:(?:external|static|abstract|factory|const|final|late|covariant|override)\s+)*(?:(?:[A-Za-z_$][A-Za-z0-9_$]*|void|dynamic|Future|Stream|List|Map|Set)(?:\s*<[^;{}()\n]*>)?(?:\?|\*)?(?:\s+|\s*\.\s*))?(?<name>[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\s*(?:<[^;{}()\n]*>)?\s*\([^;{}]*?\)\s*(?:async\*?|sync\*?)?\s*(?<term>\{|=>|;)/gms;
const getterRe = /^[ \t]*(?:(?:external|static|abstract|override)\s+)*(?:[A-Za-z_$][\w$<>?,.\[\] ]+\s+)?get\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?<term>\{|=>|;)/gm;
// Type and name must stay on one line ([ \t]+, not \s+): the type token class
// includes `,`, so a newline-crossing gap pairs an enum value with the next
// line's value and emits bogus fields with wrong line attribution.
const fieldRe = /^[ \t]*(?:(?:static|late|final|const)\s+)*(?:var|[A-Za-z_$][A-Za-z0-9_$<>?,.\[\] ]+)[ \t]+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=(?!>)|;|,)/gm;
const enumValueRe = /^[ \t]*(?<name>[A-Za-z_$][A-Za-z0-9_$]*)(?:\([^\n]*\))?\s*[,;]$/gm;
const callRe = /(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^;{}()]*>)?\s*\(/g;
const typeTokenRe = /\b([A-Z][A-Za-z0-9_$]*)\b/g;

export class DartAdapter extends BaseLanguageAdapter {
  id = "dart" as const;
  displayName = "Dart";
  extensions = [".dart"] as const;
  generatedSuffixes = [".g.dart", ".freezed.dart", ".mocks.dart", ".mock.dart", ".gr.dart", ".pb.dart", ".pbenum.dart", ".pbjson.dart", ".graphql.dart", ".config.dart"] as const;
  ignoredDirs = [".dart_tool", ".pub-cache"] as const;
  classLikeKinds = new Set(["class", "mixin", "enum", "extension"]);
  functionLikeKinds = new Set(["function", "method", "constructor", "getter", "setter"]);

  /** Creates context. */
  async createContext(root: string): Promise<LanguageContext> {
    const packages: Record<string, string> = {};
    const gitPaths = await gitLsFiles(root, [":(glob)**/pubspec.yaml"]);
    const candidates = gitPaths ? gitPaths.filter((item) => path.basename(item) === "pubspec.yaml").map((item) => path.join(root, item)) : await findPubspecs(root);
    for (const candidate of candidates) {
      if (candidate.split(path.sep).some((part) => [".dart_tool", "build", "node_modules"].includes(part))) continue;
      const name = await parsePubspecName(candidate);
      if (name) packages[name] = relpath(path.dirname(candidate), root);
    }
    return { root, packages, tsconfig: {} };
  }

  /** Returns whether test path. */
  override isTestPath(relPath: string): boolean {
    return relPath.startsWith("test/") || relPath.includes("/test/") || relPath.endsWith("_test.dart");
  }

  /** Parses file. */
  async parseFile(filePath: string, root: string, context: LanguageContext): Promise<ParsedFile> {
    const rel = relpath(filePath, root);
    const text = await readTextLossy(filePath);
    const clean = stripCommentsAndStrings(text);
    const starts = lineStarts(text);
    const depths = computeLineDepths(clean);
    const lines = text.split(/\r?\n/);
    const libMatch = clean.match(libraryRe);
    const parsed: ParsedFile = {
      language: this.id,
      path: rel,
      absolutePath: filePath,
      isTest: this.isTestPath(rel),
      isGenerated: this.isGeneratedPath(rel),
      packageName: packageForFile(filePath, root, context.packages),
      libraryUri: libMatch ? singleLineSignature(libMatch[1] || "", 120) : undefined,
      imports: [],
      symbols: [],
      cleanSource: clean,
      lineStarts: starts
    };

    for (const match of matchAllReset(text, importRe)) {
      const uri = match.groups?.uri;
      if (!uri) continue;
      parsed.imports.push({ kind: match.groups?.kind || "import", uri, line: posToLine(starts, match.index), resolvedPath: resolveUri(uri, filePath, root, context.packages) });
    }

    let temp = 1;
    const classRanges: ParsedSymbol[] = [];
    /** Adds class. */
    const addClass = (kind: string, rawName: string | undefined, match: IndexedMatch): void => {
      const startLine = posToLine(starts, match.index);
      const openBracePos = clean.indexOf("{", match.index);
      if (openBracePos < 0) return;
      const closeBracePos = findMatchingBrace(clean, openBracePos);
      const name = rawName || `extension@${startLine}`;
      const symbol: ParsedSymbol = {
        tempId: temp++,
        name,
        qualifiedName: name,
        kind,
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: closeBracePos === undefined ? startLine : posToLine(starts, closeBracePos),
        signature: singleLineSignature(text.slice(match.index, openBracePos + 1)),
        doc: getDocBefore(lines, startLine),
        openBracePos,
        closeBracePos,
        startPos: match.index,
        endPos: closeBracePos ?? openBracePos
      };
      parsed.symbols.push(symbol);
      classRanges.push(symbol);
    };

    for (const match of matchAllReset(clean, classRe)) addClass(match.groups?.kind || "class", match.groups?.name, match);
    for (const match of matchAllReset(clean, extensionRe)) addClass("extension", match.groups?.name, match);
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

    const occupied = new Set(classRanges.map((symbol) => symbol.startLine));
    for (const match of matchAllReset(clean, typedefRe)) {
      const startLine = posToLine(starts, match.index);
      if (depthAtLine(depths, startLine) !== 0) continue;
      const name = match.groups?.name || "";
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: name,
        kind: "typedef",
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: posToLine(starts, match.index + match[0].length),
        signature: singleLineSignature(text.slice(match.index, match.index + match[0].length)),
        doc: getDocBefore(lines, startLine),
        startPos: match.index,
        endPos: match.index + match[0].length
      });
    }

    for (const match of matchAllReset(clean, callableDeclRe)) {
      const startLine = posToLine(starts, match.index);
      if (occupied.has(startLine)) continue;
      const name = (match.groups?.name || "").replace(/\s+/g, "");
      const rootName = name.split(".", 1)[0] || name;
      if (dartKeywords.has(rootName) || callNoise.has(rootName)) continue;
      const parent = parentFor(match.index);
      if (!validDepth(startLine, parent)) continue;
      const term = match.groups?.term || "";
      const termPos = match.index + match[0].lastIndexOf(term);
      let endPos = match.index + match[0].length;
      let closeBracePos: number | undefined;
      if (term === "{") {
        closeBracePos = findMatchingBrace(clean, termPos);
        if (closeBracePos !== undefined) endPos = closeBracePos;
      } else if (term === "=>") {
        const semi = clean.indexOf(";", match.index + match[0].length);
        if (semi !== -1) endPos = semi;
      } else {
        endPos -= 1;
      }
      const signature = singleLineSignature(text.slice(match.index, termPos));
      let kind = parent ? "method" : "function";
      if (parent && (rootName === parent.name || rootName.startsWith(`${parent.name}.`) || signature.includes("factory "))) kind = "constructor";
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: parent ? `${parent.name}.${name}` : name,
        kind,
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: posToLine(starts, endPos),
        signature,
        doc: getDocBefore(lines, startLine),
        parentTempId: parent?.tempId,
        openBracePos: closeBracePos === undefined ? undefined : termPos,
        closeBracePos,
        startPos: match.index,
        endPos
      });
    }

    for (const match of matchAllReset(clean, getterRe)) {
      const startLine = posToLine(starts, match.index);
      const parent = parentFor(match.index);
      if (!validDepth(startLine, parent)) continue;
      const name = match.groups?.name || "";
      if (dartKeywords.has(name)) continue;
      const openBracePos = match.groups?.term === "{" ? clean.indexOf("{", match.index) : undefined;
      const closeBracePos = openBracePos === undefined ? undefined : findMatchingBrace(clean, openBracePos);
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: parent ? `${parent.name}.${name}` : name,
        kind: "getter",
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: closeBracePos === undefined ? startLine : posToLine(starts, closeBracePos),
        signature: singleLineSignature(text.slice(match.index, openBracePos === undefined ? match.index + match[0].length : openBracePos + 1)),
        doc: getDocBefore(lines, startLine),
        parentTempId: parent?.tempId,
        openBracePos,
        closeBracePos,
        startPos: match.index,
        endPos: closeBracePos ?? match.index + match[0].length
      });
    }

    const parenDepths = computeLineParenDepths(clean);
    for (const match of matchAllReset(clean, fieldRe)) {
      const startLine = posToLine(starts, match.index);
      const parent = parentFor(match.index);
      if (!parent || !validDepth(startLine, parent)) continue;
      // A line starting inside an unclosed `(` is a constructor/method
      // parameter or argument continuation, never a field declaration.
      if (depthAtLine(parenDepths, startLine) > 0) continue;
      const name = match.groups?.name || "";
      if (dartKeywords.has(name)) continue;
      // `int get foo;` matches fieldRe with "int get" as the type; getters
      // are indexed by getterRe, so skip them here to avoid duplicates.
      if (new RegExp(`\\bget\\s+${name}\\b`).test(match[0])) continue;
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: `${parent.name}.${name}`,
        kind: "field",
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: startLine,
        signature: singleLineSignature(lines[startLine - 1] || name),
        doc: getDocBefore(lines, startLine),
        parentTempId: parent.tempId,
        startPos: match.index,
        endPos: match.index + match[0].length
      });
    }

    // Enum values: bare `name,` / `name(args),` lines directly inside an enum
    // body. Other member kinds are already claimed by the passes above.
    const taken = new Set(parsed.symbols.map((symbol) => symbol.startLine));
    for (const match of matchAllReset(clean, enumValueRe)) {
      const startLine = posToLine(starts, match.index);
      if (taken.has(startLine)) continue;
      if (depthAtLine(parenDepths, startLine) > 0) continue;
      const parent = parentFor(match.index);
      if (!parent || parent.kind !== "enum" || !validDepth(startLine, parent)) continue;
      const name = match.groups?.name || "";
      if (dartKeywords.has(name)) continue;
      parsed.symbols.push({
        tempId: temp++,
        name,
        qualifiedName: `${parent.name}.${name}`,
        kind: "enum_value",
        visibility: name.startsWith("_") ? "private" : "public",
        startLine,
        endLine: startLine,
        signature: singleLineSignature(lines[startLine - 1] || name),
        doc: getDocBefore(lines, startLine),
        parentTempId: parent.tempId,
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
      if (!callNoise.has(name) && !dartKeywords.has(name)) yield name;
    }
  }

  /** Supports the type names helper. */
  *typeNames(text: string): Iterable<string> {
    for (const match of text.matchAll(typeTokenRe)) {
      const name = match[1]!;
      if (!primitiveTypes.has(name) && !callNoise.has(name)) yield name;
    }
  }
}

/** Parses pubspec name. */
async function parsePubspecName(filePath: string): Promise<string | undefined> {
  try {
    const text = await readTextLossy(filePath);
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*name\s*:\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*$/);
      if (match) return match[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Finds pubspecs. */
async function findPubspecs(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  /** Walks. */
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || [".dart_tool", "build", "node_modules", ".git"].includes(entry.name)) continue;
      const child = path.join(dir, entry.name);
      const pubspec = path.join(child, "pubspec.yaml");
      if (await pathExists(pubspec)) out.push(pubspec);
      await walk(child);
    }
  }
  const rootPubspec = path.join(root, "pubspec.yaml");
  if (await pathExists(rootPubspec)) out.push(rootPubspec);
  await walk(root);
  return out;
}

/** Resolves uri. */
function resolveUri(uri: string, currentFile: string, root: string, packages: Record<string, string>): string | undefined {
  if (uri.startsWith("dart:") || uri.startsWith("package:flutter/")) return undefined;
  if (uri.startsWith("package:")) {
    const rest = uri.slice("package:".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return undefined;
    const packageName = rest.slice(0, slash);
    const sub = rest.slice(slash + 1);
    const packageRoot = packages[packageName];
    if (!packageRoot) return undefined;
    return relpath(path.join(root, packageRoot, "lib", sub), root);
  }
  return relpath(path.resolve(path.dirname(currentFile), uri), root);
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
