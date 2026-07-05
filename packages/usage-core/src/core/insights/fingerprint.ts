import { createHash } from "node:crypto";

/**
 * Builds a stable fingerprint for a finding from its generator, subject, and repo scope. Used as the
 * park-state key, so the same underlying pattern always maps to the same fingerprint across runs
 * regardless of which conversations happen to be in the current window.
 */
export function findingFingerprint(generator: string, subject: string, repo: string | undefined): string {
  return createHash("sha256")
    .update(JSON.stringify([generator, subject, repo || ""]))
    .digest("hex")
    .slice(0, 16);
}
