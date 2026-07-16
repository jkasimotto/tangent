import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a file via tmp-file-then-rename so a crash or a concurrent reader never observes a partial
 * write, and a failed sweep (which never reaches this call) leaves the previous file completely
 * untouched.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}
