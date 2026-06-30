import { createHash } from "node:crypto";

/** Returns a SHA-256 hex digest of value, truncated to the given length. */
export function hashString(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}
