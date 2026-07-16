import { readFile } from "node:fs/promises";
import { pathExists } from "@tangent/core";
import { resolveUserPath } from "@tangent/repo";

import { sidecarPath as defaultSidecarPath, threadsMarkdownPath, vaultRoot as defaultVaultRoot } from "../core/paths.js";
import { readSidecar, writeSidecarAtomic } from "../core/sidecar.js";
import type { RegistryEntry, SidecarState } from "../core/types.js";

export { sweep } from "../core/sweep.js";
export type { SweepOptions, SweepResult } from "../core/sweep.js";
export { deriveThreadStates } from "../core/derive.js";
export type { ThreadDerivationInput } from "../core/derive.js";
export { scanVault } from "../core/vault-scan.js";
export { renderThreadsMarkdown } from "../core/render.js";
export { renderStateOfPlaySection, updateSharedStateOfPlay } from "../core/state-of-play.js";
export { SqliteSessionStateReader } from "../core/sqlite-session-state.js";
export { ClaudeCliWhyLineRunner } from "../core/haiku.js";
export { TerminalNotifier } from "../core/notifier.js";
export { vaultRoot, sidecarPath, threadsMarkdownPath } from "../core/paths.js";
export { runRecur, runRecurDue, scanRecurFiles, TmuxWorkerLauncher } from "../core/recur.js";
export type { RecurDef, RecurSchedule, RunRecurDeps, RunRecurDueDeps, RunRecurDueResult, TmuxWorkerLauncherConfig } from "../core/recur.js";
export * from "../core/types.js";

export type ListThreadsOptions = {
  vaultRoot?: string;
  sidecarPath?: string;
};

export type ListThreadsResult = {
  exists: boolean;
  markdown?: string;
  sidecar?: SidecarState;
};

/** Reads the last-generated threads.md and sidecar without running a sweep, for `tangent threads list`. */
export async function listThreads(options: ListThreadsOptions = {}): Promise<ListThreadsResult> {
  const root = options.vaultRoot || defaultVaultRoot();
  const mdPath = threadsMarkdownPath(root);
  if (!(await pathExists(mdPath))) return { exists: false };
  const markdown = await readFile(mdPath, "utf8");
  const sidecar = await readSidecar(options.sidecarPath || defaultSidecarPath());
  return { exists: true, markdown, sidecar };
}

export type RegisterThreadOptions = {
  slug: string;
  node: string;
  worktree: string;
  tmux: string;
  /** Optional: dispatch cannot always observe a Claude session id at register time. The next sweep resolves it by matching the worktree's cwd against recent Usage sessions and backfills it here. */
  sessionId?: string;
  sidecarPath?: string;
  now?: Date;
};

/** Upserts a dispatched thread's worktree/tmux/session linkage into the sidecar registry, for `tangent threads register`. */
export async function registerThread(options: RegisterThreadOptions): Promise<RegistryEntry> {
  const sidecarFile = options.sidecarPath || defaultSidecarPath();
  const sidecar = await readSidecar(sidecarFile);
  const entry: RegistryEntry = {
    node: options.node,
    worktree: resolveUserPath(options.worktree),
    tmux: options.tmux,
    sessionId: options.sessionId,
    registeredAt: (options.now || new Date()).toISOString()
  };
  await writeSidecarAtomic(sidecarFile, { ...sidecar, registry: { ...sidecar.registry, [options.slug]: entry } });
  return entry;
}

export type AttachOptions = {
  slug: string;
  sidecarPath?: string;
};

/** Resolves the tmux attach command for a registered thread, for `tangent threads attach`. The skill layer decides how to open it (a new iTerm tab running this command). */
export async function attachCommand(options: AttachOptions): Promise<string> {
  const sidecar = await readSidecar(options.sidecarPath || defaultSidecarPath());
  const entry = sidecar.registry[options.slug];
  if (!entry) throw new Error(`No registered thread named ${JSON.stringify(options.slug)}. Run tangent threads register first.`);
  return `tmux -CC attach -t ${entry.tmux}`;
}
