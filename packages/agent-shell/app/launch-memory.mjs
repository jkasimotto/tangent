import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** A small atomic store for last successful launches by Area and kind. */
export function createLaunchMemory(file) {
  /** Reads all launch memory, treating an absent or damaged file as empty. */
  async function read() {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { return error.code === "ENOENT" ? {} : {}; }
  }

  /** Atomically writes one Area and launch-kind memory entry. */
  async function write(area, kind, ref) {
    const memory = await read();
    memory[area] = { ...(memory[area] ?? {}), [kind]: ref, at: new Date().toISOString() };
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
    await rename(temporary, file);
    return memory[area];
  }

  return { read, write };
}
