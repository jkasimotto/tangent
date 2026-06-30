import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

export function shortHash(value: string | Buffer, length = 10): string {
  return sha256(value).slice(0, length);
}
