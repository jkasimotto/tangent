import { createHash } from "node:crypto";

export function hashString(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}
