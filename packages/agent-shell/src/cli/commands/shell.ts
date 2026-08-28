// `tangent shell rebuild`: the brain's way to put a landed change in front of
// Julian. A Try it note is only true when the running server already answers
// with the new code, so this command rebuilds, restarts, and returns when the
// new boot answers (design contract:
// otto/tangent/impl-what-needs-julian-under-brains, Decision 6).

import { renderCommandHelp } from "@tangent/core";
import { booleanArg, numberArg, parseArgs, stringArg, type Args } from "@tangent/core/cli";

import { postJson, resolveServerUrl, vaultFetch } from "../client.js";
import { shellCommandSpec } from "../spec.js";

const POLL_MS = 500;
const DEFAULT_TIMEOUT_SECONDS = 240;
const REBUILD_LOG = "~/.tangent/agent-shell-rebuild.log";

/** Dispatches `tangent shell` subcommands. */
export async function runShellCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "rebuild") return rebuildCommand(args);
  if (subcommand === "migrate-launch-policy") return migrateLaunchPolicyCommand(args);
  throw new Error(`Unknown shell command: ${subcommand}. Try "tangent shell --help".`);
}

/** Previews or applies the one-time v1 default migration. */
async function migrateLaunchPolicyCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const dryRun = booleanArg(args["dry-run"]);
  const result = await postJson(server, "/api/shell/migrate-launch-policy", { apply: !dryRun });
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Handles `tangent shell rebuild`. The server builds the packages, kills
 * itself, and launchd starts it again; this command waits for the boot id to
 * change, so it returns only when the new code answers.
 */
async function rebuildCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const seconds = numberArg(args.timeout) ?? DEFAULT_TIMEOUT_SECONDS;
  const old = await bootId(server);
  if (!old) throw new Error(`Agent Shell does not answer at ${server.origin}; start it first (tangent service list).`);
  const snapshot = await vaultFetch(server, "/api/sessions");
  const commits = Array.isArray(snapshot.pendingCommits) ? snapshot.pendingCommits as Array<{ shortHash?: string; subject?: string; author?: string }> : [];
  console.log(commits.length ? "commits included:" : "commits included: none (rebuilding the deployed commit)");
  for (const commit of commits) console.log(`  ${commit.shortHash ?? ""}  ${commit.subject ?? ""} — ${commit.author ?? ""}`);
  await postJson(server, "/api/shell/rebuild", {});
  console.log(`rebuilding; waiting for the new boot (log: ${REBUILD_LOG})`);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const boot = await bootId(server);
    if (boot && boot !== old) {
      console.log(`rebuilt: Agent Shell boot ${boot} answers at ${server.origin}`);
      return;
    }
  }
  throw new Error(
    `the server did not come back with a new boot in ${seconds} s; read ${REBUILD_LOG} and launchctl print gui/$(id -u)/com.tangent.agent-shell`
  );
}

/** The running server's boot id, or "" while it does not answer. */
async function bootId(server: URL): Promise<string> {
  try {
    const sessions = await vaultFetch(server, "/api/sessions");
    const runtime = sessions.runtime as { gateway?: { boot?: unknown } } | undefined;
    return String(runtime?.gateway?.boot ?? sessions.boot ?? "");
  } catch {
    return "";
  }
}

/** Waits the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prints `tangent shell` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(shellCommandSpec));
  console.log(`
Agent Shell is the server on port 4321. Start and stop it with tangent service;
this command is the one that puts new code in front of Julian: it rebuilds the
packages, restarts the server, and returns when the new boot answers.

Examples:
  tangent shell rebuild
  tangent shell rebuild --timeout 600
  tangent shell migrate-launch-policy --dry-run
  tangent shell migrate-launch-policy
`);
}
