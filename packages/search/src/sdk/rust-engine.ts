import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import type { LoadedSearchConfig } from "../core/config.js";
import type { IndexResult } from "../core/indexer.js";
import type { CallGraphResult, OpenPlanResult, SearchQueryMode, SearchResults, SearchStatus, SkeletonResult, SymbolDetails, TestResult } from "../core/search.js";

type RustCommandOptions = {
  command: string;
  args: string[];
};

export async function rustIndex(loaded: LoadedSearchConfig, options: { languages?: string[]; includeGenerated?: boolean; force?: boolean; reedgeAll?: boolean }): Promise<IndexResult> {
  return runRustJson<IndexResult>({
    command: "index",
    args: [
      "--root",
      loaded.repo.root,
      "--db",
      rustDbPath(loaded),
      "--config-json",
      JSON.stringify(loaded.config),
      ...listArg("languages", options.languages),
      ...(options.includeGenerated ? ["--include-generated"] : []),
      ...(options.force ? ["--force"] : []),
      ...(options.reedgeAll ? ["--reedge-all"] : [])
    ]
  });
}

export async function rustSearch(loaded: LoadedSearchConfig, query: string, options: { mode: SearchQueryMode; maxResults?: number; languages?: string[]; includeTests?: boolean }): Promise<SearchResults> {
  return runRustJson<SearchResults>({
    command: "query",
    args: [
      "--db",
      rustDbPath(loaded),
      "--query",
      query,
      "--mode",
      options.mode,
      ...valueArg("max-results", options.maxResults),
      ...listArg("languages", options.languages),
      ...(options.includeTests ? ["--include-tests"] : [])
    ]
  });
}

export async function rustSymbol(loaded: LoadedSearchConfig, name: string, languages?: string[]): Promise<SymbolDetails[]> {
  return runRustJson<SymbolDetails[]>({ command: "symbol", args: ["--db", rustDbPath(loaded), "--name", name, ...listArg("languages", languages)] });
}

export async function rustCallGraph(loaded: LoadedSearchConfig, name: string, incoming: boolean, languages?: string[]): Promise<CallGraphResult> {
  return runRustJson<CallGraphResult>({
    command: incoming ? "callers" : "callees",
    args: ["--db", rustDbPath(loaded), "--name", name, ...listArg("languages", languages)]
  });
}

export async function rustTests(loaded: LoadedSearchConfig, target: string, languages?: string[]): Promise<TestResult> {
  return runRustJson<TestResult>({ command: "tests", args: ["--db", rustDbPath(loaded), "--target", target, ...listArg("languages", languages)] });
}

export async function rustSkeleton(loaded: LoadedSearchConfig, target: string, languages?: string[]): Promise<SkeletonResult> {
  return runRustJson<SkeletonResult>({ command: "skeleton", args: ["--db", rustDbPath(loaded), "--target", target, ...listArg("languages", languages)] });
}

export async function rustOpenPlan(loaded: LoadedSearchConfig, query: string, languages?: string[]): Promise<OpenPlanResult> {
  return runRustJson<OpenPlanResult>({
    command: "open-plan",
    args: ["--db", rustDbPath(loaded), "--query", query, ...listArg("languages", languages)]
  });
}

export async function rustStatus(loaded: LoadedSearchConfig): Promise<SearchStatus> {
  return runRustJson<SearchStatus>({ command: "status", args: ["--db", rustDbPath(loaded)] });
}

export function rustDbPath(loaded: LoadedSearchConfig): string {
  if (loaded.config.storage.dbPath) return loaded.paths.dbPath;
  return loaded.paths.dbPath.replace(/\.sqlite3$/, ".rust.sqlite3");
}

async function runRustJson<T>(options: RustCommandOptions): Promise<T> {
  const binary = await resolveRustBinary();
  const stdout = await spawnCapture(binary, [options.command, ...options.args]);
  return JSON.parse(stdout) as T;
}

async function resolveRustBinary(): Promise<string> {
  if (process.env.TANGENT_SEARCH_RUST_BIN) {
    await access(process.env.TANGENT_SEARCH_RUST_BIN);
    return process.env.TANGENT_SEARCH_RUST_BIN;
  }
  const candidates = [
    path.resolve(process.cwd(), "target", "release", "tangent-search-engine"),
    path.resolve(process.cwd(), "target", "debug", "tangent-search-engine"),
    path.resolve(process.cwd(), "..", "..", "target", "release", "tangent-search-engine"),
    path.resolve(process.cwd(), "..", "..", "target", "debug", "tangent-search-engine")
  ];
  const available: Array<{ path: string; mtimeMs: number }> = [];
  for (const candidate of candidates) {
    try {
      available.push({ path: candidate, mtimeMs: (await stat(candidate)).mtimeMs });
    } catch {
      // Try the next candidate.
    }
  }
  available.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (available[0]) return available[0].path;
  throw new Error("Rust search engine binary not found. Run: cargo build -p tangent-search-engine");
}

function spawnCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Rust search engine exited with ${code}`));
    });
  });
}

function listArg(name: string, values: string[] | undefined): string[] {
  return values?.length ? [`--${name}`, values.join(",")] : [];
}

function valueArg(name: string, value: number | undefined): string[] {
  return value === undefined ? [] : [`--${name}`, String(value)];
}
