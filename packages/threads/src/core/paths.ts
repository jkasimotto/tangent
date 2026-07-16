import path from "node:path";
import { tangentHome } from "@tangent/core";

/**
 * Root of the tangent vault (project trees). `TANGENT_TREES_DIR` overrides; otherwise
 * `<tangentHome>/.tangent/trees`, matching how other Tangent data (feedback.jsonl, rollup/, ...) is
 * nested under `.tangent` (see @tangent/core's `tangentHome`, which returns the *parent* of
 * `.tangent` and expects call sites to append their own child).
 */
export function vaultRoot(): string {
  return process.env.TANGENT_TREES_DIR || path.join(tangentHome(), ".tangent", "trees");
}

/** Path to the threads sidecar JSON (~/.tangent/threads-status.json by default): the daemon's registry, dedup, and count state for the statusline badge. */
export function sidecarPath(): string {
  return path.join(tangentHome(), ".tangent", "threads-status.json");
}

/** Path to the generated threads.md view inside the vault. */
export function threadsMarkdownPath(root: string = vaultRoot()): string {
  return path.join(root, "threads.md");
}
