import { watch, type FSWatcher } from "node:fs";

export type UsageSourceWatcher = {
  close(): void;
};

export type WatchUsageSourcesOptions = {
  /** Directories to watch for native transcript changes (provider homes). */
  roots: string[];
  /** Invoked after activity settles, to rebuild the index/snapshot. */
  onChange: () => void;
  /** Quiet window in milliseconds to coalesce bursts of writes. Defaults to 400ms. */
  debounceMs?: number;
};

/**
 * Watches the native transcript directories and fires a debounced callback when any
 * file under them changes, so the Usage server can rebuild its in-memory snapshot and
 * the UI sees new turns without a manual reload. Claude and Codex append to the active
 * session's JSONL on every event, so writes arrive in bursts; the debounce coalesces a
 * burst into a single rebuild. Recursive watching is requested first (macOS/Windows) and
 * falls back to a non-recursive watch on the root when the platform rejects it (Linux),
 * which still catches new session files created directly in the root.
 */
export function watchUsageSources(options: WatchUsageSourcesOptions): UsageSourceWatcher {
  const debounceMs = options.debounceMs ?? 400;
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  /** Restarts the debounce timer so a burst of writes coalesces into one onChange call. */
  const schedule = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) options.onChange();
    }, debounceMs);
  };

  for (const root of options.roots) {
    const added = addWatcher(root, schedule);
    if (added) watchers.push(added);
  }

  return {
    /** Stops every filesystem watcher and cancels any pending debounced rebuild. */
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    }
  };
}

/** Starts one filesystem watcher on a root, preferring recursive and degrading gracefully. */
function addWatcher(root: string, onActivity: () => void): FSWatcher | undefined {
  try {
    return watch(root, { recursive: true, persistent: false }, onActivity);
  } catch {
    try {
      return watch(root, { persistent: false }, onActivity);
    } catch {
      return undefined;
    }
  }
}
