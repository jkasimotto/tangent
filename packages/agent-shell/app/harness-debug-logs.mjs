import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readlink, rename, stat, symlink, unlink } from "node:fs/promises";

export const HARNESS_LOG_MAX_BYTES = 8 * 1024 * 1024;
export const HARNESS_LOG_MAX_FILES = 64;

/** Routes Pi's project-local debug path to bounded Agent Shell runtime storage. */
export async function prepareHarnessDebugLog({ command, cwd, session, root }) {
  if (!/(?:^|\s)pi-code(?:\s|$)/.test(String(command ?? "")) || !cwd || !root) return null;
  await enforceHarnessLogRetention(root);
  const key = createHash("sha256").update(`${cwd}\0${session}`).digest("hex").slice(0, 20);
  const directory = path.join(root, key);
  const target = path.join(directory, "log.jsonl");
  const linkDirectory = path.join(cwd, ".pi", "debug");
  const link = path.join(linkDirectory, "log.jsonl");
  await Promise.all([mkdir(directory, { recursive: true }), mkdir(linkDirectory, { recursive: true })]);
  const existing = await lstat(link).catch(() => null);
  if (existing?.isSymbolicLink()) {
    const same = await readlink(link).then((value) => path.resolve(linkDirectory, value) === target).catch(() => false);
    if (same) return { target, link };
    await unlink(link);
  }
  else if (existing) await unlink(link);
  await symlink(target, link);
  return { target, link };
}

/** Rotates large logs and bounds the complete harness-log file count. */
export async function enforceHarnessLogRetention(root, { maxBytes = HARNESS_LOG_MAX_BYTES, maxFiles = HARNESS_LOG_MAX_FILES } = {}) {
  await mkdir(root, { recursive: true });
  const directories = await readdir(root, { withFileTypes: true });
  for (const directory of directories.filter((entry) => entry.isDirectory())) {
    const log = path.join(root, directory.name, "log.jsonl");
    const info = await stat(log).catch(() => null);
    if (!info || info.size <= maxBytes) continue;
    const third = `${log}.3`, second = `${log}.2`, first = `${log}.1`;
    await unlink(third).catch(() => {});
    await rename(second, third).catch(() => {});
    await rename(first, second).catch(() => {});
    await rename(log, first);
  }
  const files = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const name of await readdir(path.join(root, directory.name)).catch(() => [])) {
      if (!name.startsWith("log.jsonl")) continue;
      const file = path.join(root, directory.name, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) files.push({ file, mtime: info.mtimeMs });
    }
  }
  files.sort((left, right) => right.mtime - left.mtime);
  await Promise.all(files.slice(maxFiles).map((item) => unlink(item.file).catch(() => {})));
  return { files: Math.min(files.length, maxFiles), removed: Math.max(0, files.length - maxFiles) };
}
