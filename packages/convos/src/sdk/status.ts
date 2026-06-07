import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { listJsonlFiles } from "../core/append-jsonl.js";
import { repoEventDir } from "../core/paths.js";
import { pathExists, repoInfo } from "../core/repo.js";
import type { ConvosProvider } from "../core/schema/convos-jsonl-v1.js";
import { capabilitiesForProvider } from "../core/schema/capabilities.js";
import { claudeHookPath } from "../providers/claude/hooks/config.js";
import { discoverClaudeNative } from "../providers/claude/native/discover.js";
import { codexHookPath } from "../providers/codex/hooks/config.js";

const execFileAsync = promisify(execFile);

export type StatusOptions = {
  repo: string;
  providers?: ConvosProvider[];
};

export type ProviderStatus = {
  provider: ConvosProvider;
  supported: true;
  native: "available" | "best-effort" | "unavailable";
  nativePaths: string[];
  hooks: {
    global: { installed: boolean; path: string };
    repoLocal: { installed: boolean; path: string };
    repoShared: { installed: boolean; path: string };
  };
  capture: {
    enabled: boolean;
    logDir: string;
    lastEvent?: string;
  };
  capabilities: ReturnType<typeof capabilitiesForProvider>;
};

export type RepoStatus = {
  repo: {
    path: string;
    gitRoot?: string;
    branch?: string;
    headSha?: string;
    tracking: boolean;
    trackingSource: string;
  };
  providers: ProviderStatus[];
};

export async function status(options: StatusOptions): Promise<RepoStatus> {
  const providers = options.providers || ["claude", "codex"];
  const info = await repoInfo(options.repo);
  const root = info.root || info.cwd;
  const providerStatuses: ProviderStatus[] = [];

  for (const provider of providers) {
    const logDir = repoEventDir(root, provider);
    const files = await listJsonlFiles(logDir);
    const nativePaths = provider === "claude" ? await discoverClaudeNative(root) : [];
    const hooks = {
      global: await hookStatus(provider, "global", root),
      repoLocal: await hookStatus(provider, "repo-local", root),
      repoShared: await hookStatus(provider, "repo-shared", root)
    };
    providerStatuses.push({
      provider,
      supported: true,
      native: provider === "claude" ? (nativePaths.length ? "available" : "unavailable") : "best-effort",
      nativePaths,
      hooks,
      capture: {
        enabled: hasAnyInstalledHook(hooks),
        logDir,
        lastEvent: await newestMtime(files)
      },
      capabilities: capabilitiesForProvider(provider)
    });
  }

  return {
    repo: {
      path: info.cwd,
      gitRoot: info.root,
      branch: info.branch,
      headSha: info.headSha,
      tracking: providerStatuses.some((provider) => provider.capture.enabled),
      trackingSource: "installed-hooks"
    },
    providers: providerStatuses
  };
}

function hasAnyInstalledHook(hooks: ProviderStatus["hooks"]): boolean {
  return hooks.global.installed || hooks.repoLocal.installed || hooks.repoShared.installed;
}

async function hookStatus(provider: ConvosProvider, scope: "global" | "repo-local" | "repo-shared", root: string): Promise<{ installed: boolean; path: string }> {
  const hookPath = provider === "claude" ? claudeHookPath(scope, root) : codexHookPath(scope, root);
  let installed = await hasTangentHookCommand(hookPath, provider, scope);
  if (installed && provider === "codex" && scope !== "global") {
    const tracked = await isGitTracked(root, hookPath);
    installed = scope === "repo-shared" ? tracked : !tracked;
  }
  return { installed, path: hookPath };
}

async function hasTangentHookCommand(filePath: string, provider: ConvosProvider, scope: "global" | "repo-local" | "repo-shared"): Promise<boolean> {
  if (!(await pathExists(filePath))) return false;
  try {
    const text = await readFile(filePath, "utf8");
    const config = JSON.parse(text) as unknown;
    const commands = collectHookCommands(config);
    const expectedProvider = `--provider ${provider}`;
    const expectedScope = `--scope ${scope}`;
    return commands.some((command) => {
      const isCurrent = command.includes("tangent convos hook record");
      const isBareConvos = command.includes("convos hook record");
      const isLegacy = command.includes("pagent convos hook record");
      return (isCurrent || isBareConvos || isLegacy) && command.includes(expectedProvider) && command.includes(expectedScope);
    });
  } catch {
    return false;
  }
}

function collectHookCommands(value: unknown): string[] {
  const commands: string[] = [];
  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.command === "string") commands.push(record.command);
    for (const child of Object.values(record)) visit(child);
  }
  visit(value);
  return commands;
}

async function isGitTracked(root: string, filePath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", root, "ls-files", "--error-unmatch", filePath]);
    return true;
  } catch {
    return false;
  }
}

async function newestMtime(files: string[]): Promise<string | undefined> {
  let newest = 0;
  for (const file of files) {
    const fileStat = await stat(file);
    newest = Math.max(newest, fileStat.mtimeMs);
  }
  return newest ? new Date(newest).toISOString() : undefined;
}
