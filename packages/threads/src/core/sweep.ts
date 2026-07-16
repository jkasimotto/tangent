import path from "node:path";
import { pathExists } from "@tangent/core";
import { commitAll } from "@tangent/repo";
import { deriveThreadStates, type ThreadDerivationInput } from "./derive.js";
import { TerminalNotifier } from "./notifier.js";
import { sidecarPath as defaultSidecarPath, vaultRoot as defaultVaultRoot } from "./paths.js";
import { compareByUrgency, renderThreadsMarkdown } from "./render.js";
import { readSidecar, writeSidecarAtomic } from "./sidecar.js";
import { writeFileAtomic } from "./atomic-write.js";
import { renderStateOfPlaySection, updateSharedStateOfPlay } from "./state-of-play.js";
import { scanVault } from "./vault-scan.js";
import { evaluateWakeCondition, parseWakeCondition, RepoGitProbe, type GitProbe } from "./wake.js";
import type {
  DerivedThread,
  NeedsYouEntry,
  Notifier,
  OverviewItem,
  RegistryEntry,
  SessionState,
  SessionStateReader,
  SharedStateWriter,
  SidecarCounts,
  SidecarState,
  StateOfPlaySpliceResult,
  ThreadState,
  VaultScan,
  WhyLineRunner,
  WhyLineRunnerResult
} from "./types.js";

export type SweepOptions = {
  vaultRoot?: string;
  sidecarPath?: string;
  now?: Date;
  /** Skips writing threads.md/the sidecar and skips notifying; the result still reports what would happen. */
  dryRun?: boolean;
  sessionStateReader?: SessionStateReader;
  whyLineRunner?: WhyLineRunner;
  notifier?: Notifier;
  /** Evaluates "merged" wake conditions against local git state; defaults to a real RepoGitProbe. Injectable so tests never shell out to git. */
  gitProbe?: GitProbe;
  /** Writes (and commits) each shared node's generated state-of-play section; defaults to a real filesystem+git writer. Injectable so tests can assert which nodes the sweep updates without touching real git. */
  sharedWriter?: SharedStateWriter;
};

export type SweepResult = {
  vaultRoot: string;
  sidecarPath: string;
  sidecar: SidecarState;
  markdown: string;
  derived: DerivedThread[];
  unowned: OverviewItem[];
  /** Slugs notified (or, in dry-run, that would have been notified) this sweep. */
  notifiedSlugs: string[];
  dryRun: boolean;
};

const notifiableStates = new Set<ThreadState>(["blocked-on-you", "needs-you"]);

/**
 * Runs one sweep: scans the vault, deterministically derives every thread's state, asks a cheap
 * model for why-lines and check-in drafts (best-effort), renders threads.md, and fires
 * notifications for newly-attention-needing threads. A scan or derivation error propagates and
 * nothing is written: threads.md and the sidecar are only touched once every upstream step has
 * succeeded, and that final write is atomic. A why-line (haiku) failure never fails the sweep: it
 * falls back to the templated why-lines computed during derivation.
 */
export async function sweep(options: SweepOptions = {}): Promise<SweepResult> {
  const root = options.vaultRoot || defaultVaultRoot();
  const sidecarFile = options.sidecarPath || defaultSidecarPath();
  const now = options.now || new Date();
  const sessionStateReader = options.sessionStateReader || await defaultSessionStateReader();
  const notifier = options.notifier || new TerminalNotifier();
  const gitProbe = options.gitProbe || new RepoGitProbe();
  const sharedWriter = options.sharedWriter || new GitSharedStateWriter();

  const scan = await scanVault(root);
  const sidecar = await readSidecar(sidecarFile);

  const { derivationInputs, registryUpdates } = await buildDerivationInputs(scan, sidecar, sessionStateReader, gitProbe, now);
  const derived = deriveThreadStates(derivationInputs, now);

  const whyResult = await resolveWhyLines(options.whyLineRunner, derived, scan);
  const unowned = scan.overviewItems.filter((item) => !item.owned);
  const markdown = renderThreadsMarkdown({ vaultRoot: root, derived, whyLines: whyResult.whyLines, unowned, now });

  const { notified, newlyNotified } = computeNotificationTransition(sidecar.notified, derived);
  if (!options.dryRun) {
    for (const slug of newlyNotified) {
      const thread = derived.find((item) => item.slug === slug);
      if (!thread) continue;
      await notifier.notify({ title: `threads: ${slug}`, message: whyResult.whyLines[slug] || thread.templateWhy });
    }
  }

  const counts = countByState(derived);
  counts.unowned = unowned.length;
  const nextSidecar: SidecarState = {
    sweptAt: now.toISOString(),
    counts,
    needsYou: buildNeedsYouList(derived, whyResult.whyLines),
    registry: { ...sidecar.registry, ...registryUpdates },
    notified,
    // Sweep never touches recurring-dispatch state (runRecur owns it); carry it forward unchanged
    // so a sweep between two dispatches can never wipe out isDue's last-fired bookkeeping.
    recur: sidecar.recur ?? {}
  };

  if (!options.dryRun) {
    await writeFileAtomic(path.join(root, "threads.md"), markdown);
    await writeSidecarAtomic(sidecarFile, nextSidecar);
    await updateSharedNodes(root, derived, whyResult.whyLines, now, sharedWriter);
  }

  return {
    vaultRoot: root,
    sidecarPath: sidecarFile,
    sidecar: nextSidecar,
    markdown,
    derived,
    unowned,
    notifiedSlugs: newlyNotified,
    dryRun: Boolean(options.dryRun)
  };
}

/** Lazily imports the SQLite-backed default reader so a caller that always injects its own reader (every test) never needs better-sqlite3 available. */
async function defaultSessionStateReader(): Promise<SessionStateReader> {
  const { SqliteSessionStateReader } = await import("./sqlite-session-state.js");
  return new SqliteSessionStateReader();
}

/**
 * Resolves each thread's session state and, for registry entries missing a session id (dispatch
 * cannot always observe it), resolves and stages the id by matching the registered worktree's cwd
 * against recent Usage sessions. Also merges each owned overview item's 📅 deadline into its owning
 * thread's deadline candidates, and evaluates each thread's wake condition (if any) against the
 * current clock and local git state.
 */
async function buildDerivationInputs(
  scan: VaultScan,
  sidecar: SidecarState,
  reader: SessionStateReader,
  gitProbe: GitProbe,
  now: Date
): Promise<{ derivationInputs: ThreadDerivationInput[]; registryUpdates: Record<string, RegistryEntry> }> {
  const overviewDeadlinesBySlug = new Map<string, string[]>();
  for (const item of scan.overviewItems) {
    if (!item.owned || !item.ownedSlug || !item.deadline) continue;
    const list = overviewDeadlinesBySlug.get(item.ownedSlug) || [];
    list.push(item.deadline);
    overviewDeadlinesBySlug.set(item.ownedSlug, list);
  }

  const registryUpdates: Record<string, RegistryEntry> = {};
  const derivationInputs: ThreadDerivationInput[] = [];
  for (const thread of scan.threads) {
    const registryEntry = sidecar.registry[thread.slug];
    let sessionState: SessionState | undefined;
    if (registryEntry) {
      const sessionId = registryEntry.sessionId || await reader.resolveSessionIdByCwd(registryEntry.worktree, now);
      if (sessionId && sessionId !== registryEntry.sessionId) registryUpdates[thread.slug] = { ...registryEntry, sessionId };
      if (sessionId) sessionState = await reader.read(sessionId, now);
    }
    const wakeMet = thread.wakeCondition
      ? await evaluateWakeCondition(parseWakeCondition(thread.wakeCondition), now, gitProbe)
      : undefined;
    derivationInputs.push({
      thread,
      sessionState,
      latestNoteDateInNode: scan.noteRecencyByNode.get(thread.node),
      extraDeadlines: overviewDeadlinesBySlug.get(thread.slug),
      wakeMet
    });
  }
  return { derivationInputs, registryUpdates };
}

/** Runs the injected why-line runner, if any; any failure (missing binary, timeout, bad JSON) is swallowed and falls back to the templated why-lines already computed during derivation. */
async function resolveWhyLines(runner: WhyLineRunner | undefined, derived: DerivedThread[], scan: VaultScan): Promise<WhyLineRunnerResult> {
  if (!runner) return { whyLines: {}, drafts: {} };
  try {
    return await runner.run({
      derived,
      threadsBySlug: new Map(scan.threads.map((thread) => [thread.slug, thread])),
      overviewExcerptsByNode: buildOverviewExcerpts(scan)
    });
  } catch {
    return { whyLines: {}, drafts: {} };
  }
}

/** Joins each node's "## On me" item texts into a short bullet list, for haiku prompt context. */
function buildOverviewExcerpts(scan: VaultScan): Map<string, string> {
  const byNode = new Map<string, string[]>();
  for (const item of scan.overviewItems) {
    const list = byNode.get(item.node) || [];
    list.push(`- ${item.text}`);
    byNode.set(item.node, list);
  }
  return new Map([...byNode.entries()].map(([node, lines]) => [node, lines.join("\n")]));
}

/**
 * Computes the notified-map transition and the slugs newly entering a notifiable state since the
 * previous sweep: a thread already notified for its current state does not notify again, but leaving
 * and re-entering a notifiable state (or first entering one) notifies again.
 */
function computeNotificationTransition(previousNotified: Record<string, ThreadState>, derived: DerivedThread[]): { notified: Record<string, ThreadState>; newlyNotified: string[] } {
  const notified: Record<string, ThreadState> = {};
  const newlyNotified: string[] = [];
  for (const thread of derived) {
    if (!notifiableStates.has(thread.state)) continue;
    notified[thread.slug] = thread.state;
    if (previousNotified[thread.slug] !== thread.state) newlyNotified.push(thread.slug);
  }
  return { notified, newlyNotified };
}

/** Tallies derived threads per state for the sidecar's statusline counts; "done" threads contribute to no count. */
function countByState(derived: DerivedThread[]): SidecarCounts {
  const counts: SidecarCounts = { needsYou: 0, blocked: 0, working: 0, ready: 0, parked: 0, unowned: 0 };
  for (const thread of derived) {
    if (thread.state === "needs-you") counts.needsYou += 1;
    else if (thread.state === "blocked-on-you") counts.blocked += 1;
    else if (thread.state === "working") counts.working += 1;
    else if (thread.state === "ready-for-you") counts.ready += 1;
    else if (thread.state === "parked") counts.parked += 1;
  }
  return counts;
}

/** Builds the sidecar's needsYou list (blocked, needs-you, and ready-for-you threads, most urgent first) for the statusline badge. */
function buildNeedsYouList(derived: DerivedThread[], whyLines: Record<string, string>): NeedsYouEntry[] {
  return derived
    .filter((thread) => notifiableStates.has(thread.state) || thread.state === "ready-for-you")
    .sort(compareByUrgency)
    .map((thread) => ({ slug: thread.slug, why: whyLines[thread.slug] || thread.templateWhy }));
}

/**
 * Regenerates the "Delegated threads" section of every shared node's state-of-play.md: groups
 * non-done derived threads by node, and for every node that both owns a `shared/` directory and has
 * at least one such thread, renders and hands the section to `writer`. One node's failure (a bad
 * path, a git error) is logged to stderr and never fails the sweep or any other node's update: this
 * shared mirror is a courtesy, not the sweep's source of truth. A "malformed" result (the node's
 * state-of-play.md has an orphaned or otherwise ambiguous marker pair; see `updateSharedStateOfPlay`)
 * is not an error the writer throws, so it is handled here rather than in the catch: logged with the
 * file path and marker counts so a human can fix the markers by hand, and otherwise skipped exactly
 * like a caught error.
 */
async function updateSharedNodes(root: string, derived: DerivedThread[], whyLines: Record<string, string>, now: Date, writer: SharedStateWriter): Promise<void> {
  const byNode = new Map<string, DerivedThread[]>();
  for (const thread of derived) {
    if (thread.state === "done") continue;
    const list = byNode.get(thread.node) || [];
    list.push(thread);
    byNode.set(thread.node, list);
  }
  for (const [node, threads] of byNode) {
    const nodeDir = path.join(root, node);
    if (!(await pathExists(path.join(nodeDir, "shared")))) continue;
    try {
      const section = renderStateOfPlaySection(threads, whyLines, now);
      const result = await writer.write(nodeDir, section);
      if (typeof result === "object" && result.status === "malformed") {
        const filePath = path.join(nodeDir, "shared", "state-of-play.md");
        console.error(`threads sweep: state-of-play markers malformed in ${filePath}: found ${result.beginCount} begin / ${result.endCount} end; fix by hand`);
      }
    } catch (error) {
      console.error(`threads sweep: failed to update shared state-of-play for node "${node}":`, error);
    }
  }
}

/**
 * Default `SharedStateWriter`: splices the section into `<nodeDir>/shared/state-of-play.md` via
 * `updateSharedStateOfPlay`, then, only when that actually wrote a change and `<nodeDir>/shared/.git`
 * exists (an fs check, never a git call, so a shared/ that is not its own repo is left alone), commits
 * it locally with `commitAll`. Never pushes. A "malformed" result passes straight through untouched:
 * there is nothing to commit, and it is `updateSharedNodes`'s job (not this writer's) to log it.
 */
class GitSharedStateWriter implements SharedStateWriter {
  /** Splices `section` into the node's shared state-of-play.md and commits the change locally when the shared directory is its own git repo. */
  async write(nodeDir: string, section: string): Promise<StateOfPlaySpliceResult> {
    const result = await updateSharedStateOfPlay(nodeDir, section);
    const sharedDir = path.join(nodeDir, "shared");
    if (result === "written" && (await pathExists(path.join(sharedDir, ".git")))) {
      await commitAll(sharedDir, "update: state-of-play threads section");
    }
    return result;
  }
}
