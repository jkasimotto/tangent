import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Computes the SHA-256 hex digest of a string or Buffer. */
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Computes the SHA-256 hex digest of a file's contents. */
export async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

/** Returns a truncated SHA-256 hex digest of the input. */
export function shortHash(value: string | Buffer, length = 10): string {
  return sha256(value).slice(0, length);
}
