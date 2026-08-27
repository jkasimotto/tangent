import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, listAreaPaths, postJson, requireArea, resolveServerUrl, vaultFetch } from "../client.js";
import { areaCommandSpec } from "../spec.js";

/** Dispatches `tangent area` subcommands. */
export async function runAreaCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  if (subcommand === "recent") return recentCommand(args);
  if (subcommand === "audit") return auditCommand(args);
  if (subcommand === "create") return createCommand(args);
  if (subcommand === "done") return statusCommand(args, "done");
  if (subcommand === "reopen") return statusCommand(args, "active");
  throw new Error(`Unknown area command: ${subcommand}. Try "tangent area list", "tangent area show <area>", "tangent area create <parent> <name>", "tangent area done <area>", or "tangent area reopen <area>".`);
}

/** Exports legacy coordination records to a detached compressed audit file. */
async function auditCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area audit requires <area>."));
  const result = await postJson(server, "/api/areas/legacy-audit", { area });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  console.log(`legacy audit: ${result.output}`);
  for (const source of result.manifest) console.log(`  ${source.name}: ${source.records} records  sha256:${source.hash}`);
}

/** Handles `tangent area recent <area>` with subtree context by default. */
async function recentCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area recent requires <area>."));
  const query = new URLSearchParams({ area, limit: stringArg(args.limit) || "12" });
  if (stringArg(args.since)) query.set("since", stringArg(args.since) || "");
  if (stringArg(args.query)) query.set("query", stringArg(args.query) || "");
  const result = await vaultFetch(server, `/api/areas/milestones?${query}`);
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  if (!result.milestones.length) console.log(`No material milestones in ${area} or its child Areas${stringArg(args.query) || stringArg(args.since) ? " match these filters" : ""}.`);
  for (const item of result.milestones) console.log(`${item.createdAt}  ${item.area}  ${item.kind}  ${item.summary}`);
  if (result.omitted) console.log(`${result.omitted} more. Increase --limit, or narrow with --since and --query.`);
}

/** Handles `tangent area list`. */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const paths = [...await listAreaPaths(server)].sort();
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(paths, null, 2));
    return;
  }
  if (!paths.length) {
    console.log("No Areas yet.");
    return;
  }
  for (const path of paths) console.log(path);
}

/** Handles `tangent area show <area>`. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], "tangent area show requires <area>."));
  const detail = await vaultFetch(server, `/api/areas/show?area=${encodeURIComponent(area)}`);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  console.log(detail.area);
  if (detail.purpose) {
    console.log("");
    console.log("Purpose:");
    console.log(detail.purpose);
  }
  printResources(detail);
  console.log("");
  console.log(`Goals (${detail.goals.length}):`);
  if (!detail.goals.length) console.log("  none");
  for (const goal of detail.goals) console.log(`  ${goal.slug}  [${goal.status}]  ${goal.title}`);
  console.log("");
  console.log(`Ideas (${detail.ideas.length}):`);
  if (!detail.ideas.length) console.log("  none");
  for (const idea of detail.ideas) console.log(`  - ${idea}`);
}

/**
 * Prints the resource lines the Area sees, each with the Area that declared
 * it, and the folder a worker starts in, so a brain reading
 * `tangent area show` knows where the Area's work runs without opening the
 * note.
 */
function printResources(detail: AreaShowDetail): void {
  const resolved = detail.resolved ?? {};
  const lines = [
    ["Repository", resolved.repository],
    ["Worktree", resolved.worktree],
    ["Branch", resolved.branch],
  ].filter((entry): entry is [string, ResolvedResource] => Boolean(entry[1]));
  console.log("");
  console.log("Resources:");
  if (!lines.length) console.log("  Repository: none bound");
  for (const [label, item] of lines) console.log(`  ${label}: ${item.value} (from ${item.area})`);
  if (detail.workFolder) console.log(`  Workers start in ${detail.workFolder.cwd} (from ${detail.workFolder.source})`);
}

/** One resource value with the Area whose note declares it. */
type ResolvedResource = { value: string; area: string };

/** The parts of `/api/areas/show` the resource printout reads. */
type AreaShowDetail = {
  resolved?: { repository?: ResolvedResource | null; worktree?: ResolvedResource | null; branch?: ResolvedResource | null };
  workFolder?: { cwd: string; source: string } | null;
};

/**
 * Handles `tangent area create <parent> <name>`: the same route the desk uses, so an agent
 * (the Area brain, a describe-work agent) creates a sub-Area with the desk's note shape and
 * a provenance commit instead of hand-writing the vault.
 */
async function createCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const parent = await requireArea(server, requiredString(args._[1], "tangent area create requires <parent> <name>."));
  const name = args._.slice(2).map(String).join(" ").trim();
  if (!name) throw new Error("tangent area create requires <name> after the parent Area.");
  const caller = await currentTmuxSession();
  const created = await postJson(server, "/api/areas/new", { parent, name, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(created, null, 2));
    return;
  }
  console.log(`area: ${created.area}`);
  console.log(`note: ${created.note}`);
}

/**
 * Handles `tangent area done <area>` and `tangent area reopen <area>`. Status is written on
 * Julian's explicit word only, as `tangent goal done` is: an Area with no open work is not
 * done until he says so. Goals inside the Area are not changed.
 */
async function statusCommand(args: Args, status: "done" | "active"): Promise<void> {
  const verb = status === "done" ? "done" : "reopen";
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args._[1], `tangent area ${verb} requires <area>.`));
  const result = await postJson(server, "/api/areas/status", { area, status, session: await currentTmuxSession() });
  const open = Number(result.openGoals ?? 0);
  if (status === "done") console.log(`${area} marked done.${open ? ` ${open} open Goal${open === 1 ? " stays" : "s stay"} open and hidden.` : ""}`);
  else console.log(`${area} reopened.`);
}

/** Prints `tangent area` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(areaCommandSpec));
  console.log(`
Examples:
  tangent area list
  tangent area list --json
  tangent area show otto/tangent
  tangent area create otto/tangent "Area map"
  tangent area done neara/hackathon
  tangent area reopen neara/hackathon
`);
}
