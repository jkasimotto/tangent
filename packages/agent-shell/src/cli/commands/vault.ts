import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderCommandHelp } from "@tangent/core";
import { parseArgs, stringArg } from "@tangent/core/cli";
import { git } from "@tangent/repo/git";

import { WORKER_MUTATION_REFUSAL, currentSessionIsWorker, currentTmuxSession } from "../client.js";
import { vaultCommandSpec } from "../spec.js";

const COMMIT_VERBS = ["add", "note", "update", "remove"];

/**
 * Dispatches `tangent vault` subcommands. This is the one CLI lane that talks to git directly
 * instead of the Agent Shell server: a provenance-correct commit in ~/.tangent/trees, mirroring
 * the server's own vaultCommit() (packages/agent-shell/app/server.mjs) so both lanes produce
 * identical commits.
 */
export async function runVaultCli(argv = process.argv.slice(2)): Promise<void> {
  if (!argv.length || argv[0] === "--help") return help();
  if (argv[0] !== "commit") throw new Error(`Unknown vault command: ${argv[0]}. Try "tangent vault commit".`);
  await commitCommand(argv.slice(1));
}

/** Handles `tangent vault commit <paths...> -m "<verb>: <area> <summary>"`. */
async function commitCommand(rest: string[]): Promise<void> {
  if (rest.includes("--help")) return help();
  if (await currentSessionIsWorker()) throw new Error(WORKER_MUTATION_REFUSAL);
  const remaining = [...rest];
  const messageIndex = remaining.indexOf("-m");
  if (messageIndex === -1 || !remaining[messageIndex + 1]) throw new Error(commitUsage());
  const message = remaining[messageIndex + 1]!;
  remaining.splice(messageIndex, 2);

  const args = parseArgs(remaining);
  const paths = args._;
  if (!paths.length) throw new Error(commitUsage());
  for (const relativePath of paths) validateVaultPath(relativePath);
  validateCommitMessage(message);

  const treesRoot = tangentTreesRoot();
  await validateKnownVaultPaths(treesRoot, paths);
  const pathspecs = paths.map(literalVaultPathspec);
  const area = stringArg(args.area) || areaFromPath(paths[0]!);
  const trailers = [`Tangent-Area: ${area}`];
  const tmuxSession = await currentTmuxSession();
  if (tmuxSession) trailers.push(`Tangent-Tmux: ${tmuxSession}`);

  // Recover named deletions that another command already removed from the shared index, then
  // stage exactly the named paths. Both commands are path-limited so unrelated edits stay put.
  await git(treesRoot, ["reset", "-q", "HEAD", "--", ...pathspecs]);
  await git(treesRoot, ["add", "--", ...pathspecs]);
  await git(treesRoot, ["commit", "-m", message, "-m", trailers.join("\n"), "--", ...pathspecs]);
  console.log(`committed: ${message}`);
}

/** Accepts a present path or a missing path that names tracked content at HEAD. */
async function validateKnownVaultPaths(treesRoot: string, paths: string[]): Promise<void> {
  for (const relativePath of paths) {
    try {
      await lstat(path.join(treesRoot, relativePath));
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
    }
    const tracked = (await git(treesRoot, ["ls-tree", "-r", "--name-only", "HEAD", "--", literalVaultPathspec(relativePath)])).stdout.trim();
    if (!tracked) throw new Error(`Vault path does not exist and was never tracked: ${relativePath}`);
  }
}

/** Makes Git treat a user-supplied vault path as one literal file or directory prefix. */
function literalVaultPathspec(relativePath: string): string {
  return `:(literal)${relativePath}`;
}

/** Rejects a commit message that does not match `<verb>: <area-path> <summary>`. */
function validateCommitMessage(message: string): void {
  const match = message.match(/^([a-z]+):\s+\S/);
  if (!match || !COMMIT_VERBS.includes(match[1]!)) {
    throw new Error(`Commit message must start with one of ${COMMIT_VERBS.join(", ")}: "<area> <summary>", got "${message}".`);
  }
}

/** Rejects an absolute path or one that escapes the vault. */
function validateVaultPath(relativePath: string): void {
  const clean = relativePath.replaceAll(path.sep, "/");
  if (path.posix.isAbsolute(clean) || clean.split("/").includes("..")) {
    throw new Error(`Invalid vault path: ${relativePath}`);
  }
}

/** Derives the trailer Area from one committed path's directory. */
function areaFromPath(relativePath: string): string {
  const dir = path.posix.dirname(relativePath.replaceAll(path.sep, "/"));
  return dir === "." ? "" : dir;
}

/** The local Tangent vault root; TANGENT_TREES_DIR overrides for tests and verify harnesses. */
function tangentTreesRoot(): string {
  return process.env.TANGENT_TREES_DIR || path.join(os.homedir(), ".tangent", "trees");
}

/** Shows the deliberately narrow command contract. */
function commitUsage(): string {
  return 'usage: tangent vault commit <paths...> -m "<verb>: <area> <summary>" [--area <path>]\nverb is one of add, note, update, remove.';
}

/** Prints `tangent vault` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(vaultCommandSpec));
  console.log(`
Examples:
  tangent vault commit otto/dnd/goal-connect-faces.md -m "add: otto/dnd Goal: connect chosen ramp faces"
  tangent vault commit otto/dnd/dnd.md -m "update: otto/dnd rewrite Current"
  tangent vault commit otto/dnd/goal-x.md -m "update: otto/dnd goal x edited in tree" --area otto/dnd
`);
}
