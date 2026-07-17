import { readFile } from "node:fs/promises";
import { pathExists } from "@tangent/core";
import { resolveUserPath } from "@tangent/repo";

import { sidecarPath as defaultSidecarPath, threadsMarkdownPath, vaultRoot as defaultVaultRoot } from "../core/paths.js";
import { filterViewBySubtree, renderThreadsMarkdown } from "../core/render.js";
import { readSidecar, writeSidecarAtomic } from "../core/sidecar.js";
export { readSidecar } from "../core/sidecar.js";
import type { RegistryEntry, SidecarState } from "../core/types.js";

export { sweep } from "../core/sweep.js";
export type { SweepOptions, SweepResult } from "../core/sweep.js";
export { deriveThreadStates } from "../core/derive.js";
export type { ThreadDerivationInput } from "../core/derive.js";
export { scanVault } from "../core/vault-scan.js";
export { buildThreadsView, filterViewBySubtree, nodeMatchesSubtree, renderThreadsMarkdown } from "../core/render.js";
export { attachAppleScript, openAttach, resolveTmuxBinary } from "../core/attach.js";
export { buildTimeline, loadNodeMilestone, parseMilestoneFile, renderMilestoneSlackHtml, renderMilestoneSlackText, renderMilestoneTerminal } from "../core/milestone.js";
export type { Milestone, MilestoneGroup, MilestoneOutcome, MilestoneTrack, TimelineDay } from "../core/milestone.js";
export { setClipboardRich } from "../core/clipboard.js";
export type { AttachProcessResult, AttachProcessRunner, OpenAttachOptions, OpenAttachResult } from "../core/attach.js";
export { renderStateOfPlaySection, updateSharedStateOfPlay } from "../core/state-of-play.js";
export { SqliteSessionStateReader } from "../core/sqlite-session-state.js";
export { TmuxSessionStateReader } from "../core/tmux-session-state.js";
export { ClaudeCliWhyLineRunner } from "../core/haiku.js";
export { TerminalNotifier } from "../core/notifier.js";
export { renderThreadsStatusBadge } from "../core/statusline.js";
export { cleanupThread, markValidationReady } from "../core/lifecycle.js";
export type { CleanupStep, LifecycleProcessResult, LifecycleRunner } from "../core/lifecycle.js";
export { vaultRoot, sidecarPath, threadsMarkdownPath } from "../core/paths.js";
export { runRecur, runRecurDue, scanRecurFiles, TmuxWorkerLauncher } from "../core/recur.js";
export type { RecurDef, RecurSchedule, RunRecurDeps, RunRecurDueDeps, RunRecurDueResult, TmuxWorkerLauncherConfig } from "../core/recur.js";
export * from "../core/types.js";

export type ListThreadsOptions = {
  vaultRoot?: string;
  sidecarPath?: string;
  /** Subtree query (e.g. "neara" or "neara/pgande"): re-renders the last sweep's view filtered to matching nodes instead of printing the whole threads.md. */
  subtree?: string;
};

export type ListThreadsResult = {
  exists: boolean;
  markdown?: string;
  sidecar?: SidecarState;
  /** Set when a subtree filter was requested but the sidecar predates persisted views; one sweep fixes it. */
  filterUnavailable?: boolean;
};

/** Reads the last-generated threads.md and sidecar without running a sweep, for `tangent threads list`. With a subtree query, re-renders the sidecar's persisted view filtered to matching nodes (header timestamp stays the sweep's, since that is when the data was true). */
export async function listThreads(options: ListThreadsOptions = {}): Promise<ListThreadsResult> {
  const root = options.vaultRoot || defaultVaultRoot();
  const mdPath = threadsMarkdownPath(root);
  if (!(await pathExists(mdPath))) return { exists: false };
  const sidecar = await readSidecar(options.sidecarPath || defaultSidecarPath());
  if (options.subtree) {
    if (!sidecar.view) return { exists: true, sidecar, filterUnavailable: true };
    const filtered = filterViewBySubtree(sidecar.view, options.subtree);
    const markdown = renderThreadsMarkdown({
      vaultRoot: root,
      threads: filtered.threads,
      unowned: filtered.unowned,
      now: sidecar.sweptAt ? new Date(sidecar.sweptAt) : new Date(),
      filter: options.subtree
    });
    return { exists: true, markdown, sidecar };
  }
  const markdown = await readFile(mdPath, "utf8");
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
  baseBranch?: string;
  branch?: string;
  created?: import("../core/types.js").ThreadResources;
  reused?: import("../core/types.js").ThreadResources;
  runtime?: "claude" | "pi";
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
    registeredAt: (options.now || new Date()).toISOString(),
    baseBranch: options.baseBranch,
    branch: options.branch,
    created: options.created,
    reused: options.reused,
    runtime: options.runtime
  };
  await writeSidecarAtomic(sidecarFile, { ...sidecar, registry: { ...sidecar.registry, [options.slug]: entry } });
  return entry;
}

export type AttachOptions = {
  slug: string;
  sidecarPath?: string;
};

/** Resolves the manual tmux attach command for a registered thread, for `tangent threads attach --print`. Plain attach, not `-CC`: control mode leaves a stray control window and depends on iTerm tmux-integration prefs, so `openAttach` (the default path) does not use it either. */
export async function attachCommand(options: AttachOptions): Promise<string> {
  const sidecar = await readSidecar(options.sidecarPath || defaultSidecarPath());
  const entry = sidecar.registry[options.slug];
  if (!entry) throw new Error(`No registered thread named ${JSON.stringify(options.slug)}. Run tangent threads register first.`);
  return `tmux attach -t ${entry.tmux}`;
}
