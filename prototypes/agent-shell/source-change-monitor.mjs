import { watch } from "node:fs";

const SOURCE_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svelte", ".ts"]);
const IGNORED_PARTS = new Set([".git", "dist", "node_modules"]);

/** Reports source edits made after the Agent Shell server started. */
export function createSourceChangeMonitor({ root, watchFiles = watch } = {}) {
  let changed = false;
  const watcher = watchFiles(root, { recursive: true }, (_event, filename) => {
    const file = String(filename ?? "");
    const parts = file.split(/[\\/]/);
    const dot = file.lastIndexOf(".");
    if (parts.some((part) => IGNORED_PARTS.has(part))) return;
    if (dot < 0 || !SOURCE_EXTENSIONS.has(file.slice(dot))) return;
    changed = true;
  });
  watcher?.on?.("error", (error) => console.error("agent-shell source watcher:", error.message ?? error));

  return {
    /** Whether a watched source file changed after startup. */
    get changed() { return changed; },
    /** Stops watching the repository. */
    close() { watcher?.close(); },
  };
}
