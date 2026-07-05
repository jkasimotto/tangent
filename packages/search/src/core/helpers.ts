import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const globalExcludedDirNames = new Set([
  ".git",
  ".hg",
  ".svn",
  ".dart_tool",
  ".idea",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "out",
  "target",
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".pub-cache",
  ".flutter-plugins-dependencies"
]);

const wordRe = /[A-Za-z0-9_$]+/g;

/** Supports the relpath helper. */
export function relpath(filePath: string, root: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return (relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath).split(path.sep).join("/");
}

/** Reads text lossy. */
export async function readTextLossy(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  for (const encoding of ["utf8", "latin1"] as const) {
    try {
      return data.toString(encoding);
    } catch {
      // Try the next encoding.
    }
  }
  return data.toString("utf8");
}

/** Supports the file stat tuple helper. */
export function fileStatTuple(stat: { size: number; mtimeMs: number; mtimeNs?: bigint }): { size: number; mtimeNs: number } {
  return { size: stat.size, mtimeNs: stat.mtimeNs ? Number(stat.mtimeNs) : Math.trunc(stat.mtimeMs * 1_000_000) };
}

/** Returns whether skip dir. */
export function shouldSkipDir(name: string): boolean {
  return globalExcludedDirNames.has(name);
}

/** Supports the git ls files helper. */
export async function gitLsFiles(root: string, patterns: readonly string[]): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...patterns], {
      timeout: 15000,
      maxBuffer: 64 * 1024 * 1024
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

/** Supports the line starts helper. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

/** Supports the pos to line helper. */
export function posToLine(starts: readonly number[], pos: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((starts[mid] || 0) <= pos) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Supports the line to pos helper. */
export function lineToPos(starts: readonly number[], line: number): number {
  if (line <= 1) return 0;
  return starts[line - 1] ?? starts.at(-1) ?? 0;
}

/** Computes line depths. */
export function computeLineDepths(clean: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  let lineDepth = 0;
  let atLine = true;
  for (const ch of clean) {
    if (atLine) {
      lineDepth = depth;
      atLine = false;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "\n") {
      depths.push(lineDepth);
      atLine = true;
    }
  }
  depths.push(atLine ? depth : lineDepth);
  return depths;
}

/** Supports the depth at line helper. */
export function depthAtLine(depths: readonly number[], line: number): number {
  return depths[line - 1] ?? depths.at(-1) ?? 0;
}

/** Finds matching brace. */
export function findMatchingBrace(clean: string, openPos: number): number | undefined {
  if (openPos < 0 || openPos >= clean.length || clean[openPos] !== "{") return undefined;
  let depth = 0;
  for (let index = openPos; index < clean.length; index += 1) {
    if (clean[index] === "{") depth += 1;
    else if (clean[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

/** Supports the single line signature helper. */
export function singleLineSignature(text: string, maxLen = 220): string {
  const signature = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  return signature.length > maxLen ? `${signature.slice(0, maxLen - 1).trimEnd()}...` : signature;
}

/** Returns doc before. */
export function getDocBefore(lines: readonly string[], startLine: number, maxLines = 12): string {
  const docs: string[] = [];
  let seen = 0;
  for (let index = startLine - 2; index >= 0 && seen < maxLines; index -= 1, seen += 1) {
    const stripped = (lines[index] || "").trim();
    if (!stripped) {
      if (docs.length) break;
      continue;
    }
    if (stripped.startsWith("///")) docs.push(stripped.slice(3).trim());
    else if (stripped.startsWith("//")) docs.push(stripped.slice(2).trim());
    else if (stripped.startsWith("/**") || stripped.startsWith("/*") || stripped.startsWith("*")) docs.push(stripped.replace(/^\/?\*+/, "").replace(/\*\/$/, "").trim());
    else if (!stripped.startsWith("@")) break;
  }
  return singleLineSignature(docs.reverse().join(" "), 300);
}

/** Tokenizes text. */
export function tokenizeText(text: string): string[] {
  const pieces: string[] = [];
  for (const match of text.matchAll(wordRe)) {
    const word = match[0];
    pieces.push(word.toLowerCase());
    const split = word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_$]/g, "-");
    for (const part of split.split(/[^A-Za-z0-9]+/)) {
      if (part && part.toLowerCase() !== word.toLowerCase()) pieces.push(part.toLowerCase());
    }
  }
  const stop = new Set(["the", "and", "for", "with", "from", "this", "that", "src", "lib"]);
  const seen = new Set<string>();
  return pieces.filter((piece) => {
    if (piece.length < 2 || stop.has(piece) || seen.has(piece)) return false;
    seen.add(piece);
    return true;
  });
}

/** Strips comments and strings. */
export function stripCommentsAndStrings(text: string): string {
  const out: string[] = [];
  let index = 0;
  let state: "code" | "string" = "code";
  let quote = "";
  let triple = false;
  while (index < text.length) {
    const ch = text[index]!;
    const next = text[index + 1] || "";
    if (state === "code") {
      if (ch === "/" && next === "/") {
        out.push(" ", " ");
        index += 2;
        while (index < text.length && text[index] !== "\n") {
          out.push(" ");
          index += 1;
        }
        continue;
      }
      if (ch === "/" && next === "*") {
        out.push(" ", " ");
        index += 2;
        while (index < text.length) {
          out.push(text[index] === "\n" ? "\n" : " ");
          if (text[index] === "*" && text[index + 1] === "/") {
            out.push(" ");
            index += 2;
            break;
          }
          index += 1;
        }
        continue;
      }
      if (ch === "\"" || ch === "'" || ch === "`") {
        quote = ch;
        triple = (ch === "\"" || ch === "'") && text.slice(index, index + 3) === ch.repeat(3);
        out.push(...(triple ? [" ", " ", " "] : [" "]));
        index += triple ? 3 : 1;
        state = "string";
        continue;
      }
      out.push(ch);
      index += 1;
      continue;
    }
    if (ch === "\n") {
      out.push("\n");
      index += 1;
      continue;
    }
    if (ch === "\\") {
      out.push(" ");
      if (index + 1 < text.length) out.push(text[index + 1] === "\n" ? "\n" : " ");
      index += 2;
      continue;
    }
    if (triple && text.slice(index, index + 3) === quote.repeat(3)) {
      out.push(" ", " ", " ");
      index += 3;
      state = "code";
      continue;
    }
    if (!triple && ch === quote) {
      out.push(" ");
      index += 1;
      state = "code";
      continue;
    }
    out.push(" ");
    index += 1;
  }
  return out.join("");
}

/** Supports the lines slice helper. */
export function linesSlice(text: string, startLine: number, endLine: number): string {
  return text.split(/\r?\n/).slice(Math.max(1, startLine) - 1, Math.min(text.split(/\r?\n/).length, Math.max(startLine, endLine))).join("\n");
}

/** Supports the path matches any helper. */
export function pathMatchesAny(filePath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globMatches(filePath, glob) || globMatches(path.posix.basename(filePath), glob));
}

/** Supports the glob matches helper. */
export function globMatches(value: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
