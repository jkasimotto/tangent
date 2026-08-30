import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Reads one JSON object, returning null for missing, malformed, or non-object data. */
export async function readJsonObject(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Reads one JSON object and preserves missing and malformed evidence. */
export async function readJsonObjectResult(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return { state: "malformed", file, error: "the JSON value is not an object", value: null };
    return { state: "ok", file, error: null, value: parsed };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing", file, error: null, value: null };
    if (error instanceof SyntaxError) return { state: "malformed", file, error: String(error.message ?? error), value: null };
    throw error;
  }
}

/** Atomically writes one JSON object, creating its parent directory. */
export async function writeJsonObject(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
  return value;
}

/** Recursively lists JSON files below a directory in stable order. */
export async function walkJsonFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}
