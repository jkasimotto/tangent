import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { hashString } from "@tangent/core";

/**
 * Identity of the on-disk UI build, reported to long-lived clients so they can detect a new build
 * and reload into it. `buildId` is an opaque equality token (do not parse); `builtAt` is the ISO-8601
 * UTC timestamp of the newest served asset.
 */
export type BuildIdentity = {
  buildId: string;
  builtAt: string;
};

/**
 * Derives a build identity from the bundle files under a shell asset root. The id is a short hash of
 * the asset manifest (each file's relative path, size, and mtime), so it changes whenever a new build
 * lands on disk, with or without a server restart, and stays stable when nothing changed. The shell
 * bundles are content-hashed, so their filenames already change per build; hashing the whole manifest
 * (name + size + mtime) detects rebuilds regardless of which files changed.
 *
 * Reads the `assets/` directory beneath `rootDir` (the vite bundle output). Throws if it cannot be read,
 * which the `/api/version` route maps to a 500 so the client fails quiet on an older or unbuilt server.
 */
export function readBuildIdentity(rootDir: string): BuildIdentity {
  const assetsDir = path.join(rootDir, "assets");
  const entries = readdirSync(assetsDir).sort();
  const manifest: string[] = [];
  let newestMs = 0;
  for (const name of entries) {
    const stats = statSync(path.join(assetsDir, name));
    if (!stats.isFile()) continue;
    manifest.push(`${name}:${stats.size}:${Math.trunc(stats.mtimeMs)}`);
    if (stats.mtimeMs > newestMs) newestMs = stats.mtimeMs;
  }
  if (!manifest.length) throw new Error(`No build assets found under ${assetsDir}.`);
  return {
    buildId: hashString(manifest.join("\n"), 12),
    builtAt: new Date(newestMs).toISOString()
  };
}
