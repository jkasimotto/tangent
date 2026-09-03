import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Fixture support for the lint tests: a fresh temporary repository root, fixture files written
// at their owner paths, and one way to run a lint script against that root.

/** Creates a fresh temporary directory that stands in for the repository root. */
export function makeFixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), `${name}-`));
}

/** Writes one fixture file at a repository-relative path under the fixture root. */
export function writeFixture(root, repoPath, source) {
  const absolutePath = join(root, repoPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
  return absolutePath;
}

/** Runs a lint script with --root and explicit paths; returns its status and both streams. */
export function runLint(script, root, paths) {
  try {
    const stdout = execFileSync(process.execPath, [script, "--root", root, ...paths], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}
