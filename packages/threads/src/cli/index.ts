#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";

import { attachCommand, ClaudeCliWhyLineRunner, listThreads, registerThread, sweep, type WhyLineRunner } from "../sdk/index.js";
import { booleanArg, parseArgs, stringArg } from "./args.js";
import { threadsCommandSpec } from "./spec.js";

export { threadsCommandSpec } from "./spec.js";

/**
 * Resolves the why-line runner for a `sweep` invocation. Wires the haiku pass by default, per the
 * design spec's "Haiku for sweeps" token-economics rule; a runner failure is not a sweep failure
 * (resolveWhyLines falls back to templated why-lines), so this only decides whether to attempt the
 * call at all. `--dry-run` never calls the model, so a dry run stays instant and free; `--no-model`
 * gives the same opt-out for a real sweep.
 */
export function resolveWhyLineRunner(args: { dryRun: boolean; noModel: boolean }): WhyLineRunner | undefined {
  if (args.dryRun || args.noModel) return undefined;
  return new ClaudeCliWhyLineRunner({ model: "haiku" });
}

/** Runs threads cli. */
export async function runThreadsCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || args.help) return help();

  if (command === "sweep") {
    const dryRun = booleanArg(args["dry-run"]);
    const whyLineRunner = resolveWhyLineRunner({ dryRun, noModel: booleanArg(args["no-model"]) });
    const result = await sweep({ dryRun, whyLineRunner });
    if (args.json) {
      console.log(JSON.stringify(result.sidecar, null, 2));
      return;
    }
    if (result.dryRun) {
      console.log(result.markdown);
      console.log(result.notifiedSlugs.length ? `\nwould notify: ${result.notifiedSlugs.join(", ")}` : "\nwould notify: (none)");
      return;
    }
    console.log(`threads sweep: ${result.derived.length} thread(s), ${result.unowned.length} unowned backlog item(s), ${result.notifiedSlugs.length} notification(s).`);
    console.log(`wrote ${result.vaultRoot}/threads.md`);
    return;
  }

  if (command === "list") {
    const result = await listThreads({});
    if (!result.exists) {
      console.log("No sweep has run yet. Run: tangent threads sweep");
      return;
    }
    if (args.json) {
      console.log(JSON.stringify(result.sidecar, null, 2));
      return;
    }
    console.log(result.markdown!.trimEnd());
    return;
  }

  if (command === "register") {
    const slug = required(args._[1], "register requires <slug>.");
    const entry = await registerThread({
      slug,
      node: required(stringArg(args.node), "register requires --node <vault-node-path>."),
      worktree: required(stringArg(args.worktree), "register requires --worktree <abs-path>."),
      tmux: required(stringArg(args.tmux), "register requires --tmux <session-name>."),
      sessionId: stringArg(args.session)
    });
    console.log(`registered ${slug}: node=${entry.node} worktree=${entry.worktree} tmux=${entry.tmux}${entry.sessionId ? ` session=${entry.sessionId}` : ""}`);
    return;
  }

  if (command === "attach") {
    const slug = required(args._[1], "attach requires <slug>.");
    console.log(await attachCommand({ slug }));
    return;
  }

  throw new Error(`Unknown threads command: ${command}`);
}

/** Returns the string value or throws with the given message if absent. */
function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

/** Prints threads command help. */
function help(): void {
  console.log(renderCommandHelp(threadsCommandSpec));
}

if (isDirectRun()) {
  runThreadsCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/** Returns whether direct run. */
function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
