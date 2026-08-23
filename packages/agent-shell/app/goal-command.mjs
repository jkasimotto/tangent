#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stringArg, stringsArg } from "@tangent/core/cli";

const ALLOWED_OPTIONS = new Set([
  "area",
  "description",
  "done-when",
  "server",
  "source",
  "state",
  "subgoal-done-when",
  "subgoal-title",
  "title",
]);

/** Parses one strict Goal creation command into the server's validated payload. */
export function goalCreateRequest(argv) {
  const args = parseArgs(argv, { repeatable: ["source", "subgoal-title", "subgoal-done-when"] });
  if (args._.length !== 1 || args._[0] !== "create") throw new Error(goalCommandUsage());
  const unknown = Object.keys(args).filter((key) => key !== "_" && !ALLOWED_OPTIONS.has(key));
  if (unknown.length) throw new Error(`Unknown option --${unknown[0]}.\n${goalCommandUsage()}`);

  const server = localServerUrl(stringArg(args.server) || "http://127.0.0.1:4321");
  const area = requiredOption(args.area, "--area");
  const title = requiredOption(args.title, "--title");
  const doneWhen = requiredOption(args["done-when"], "--done-when");
  const subgoalTitles = stringsArg(args["subgoal-title"]);
  const subgoalDoneConditions = stringsArg(args["subgoal-done-when"]);
  if (subgoalTitles.length !== subgoalDoneConditions.length) {
    throw new Error("Each --subgoal-title needs one --subgoal-done-when in the same position.");
  }

  return {
    server,
    payload: {
      area,
      description: stringArg(args.description)?.trim() || "",
      goal: {
        title,
        doneWhen,
        state: stringArg(args.state)?.trim() || "Not started.",
      },
      subgoals: subgoalTitles.map((subgoalTitle, index) => ({
        title: subgoalTitle.trim(),
        doneWhen: subgoalDoneConditions[index].trim(),
      })),
      sources: stringsArg(args.source).map((source) => source.trim()).filter(Boolean),
    },
  };
}

/** Sends one validated Goal structure to the Agent Shell writer. */
export async function runGoalCommand(argv = process.argv.slice(2), fetcher = fetch) {
  const request = goalCreateRequest(argv);
  const response = await fetcher(new URL("/api/goals/create", request.server), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Agent Shell returned ${response.status}.`);
  return result;
}

/** Requires a non-empty string option. */
function requiredOption(value, name) {
  const parsed = stringArg(value)?.trim();
  if (!parsed) throw new Error(`${name} is required.\n${goalCommandUsage()}`);
  return parsed;
}

/** Accepts only the local Agent Shell as a mutation target. */
function localServerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid --server URL: ${value}`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("--server must be a local HTTP Agent Shell URL.");
  }
  return url;
}

/** Shows the deliberately narrow command contract agents can copy safely. */
function goalCommandUsage() {
  return "usage: goal-command.mjs create --server <local-url> --area <path> --title <name> --done-when <condition> [--state <text>] [--description <text>] [--source <file>] [--subgoal-title <name> --subgoal-done-when <condition>]";
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runGoalCommand()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
