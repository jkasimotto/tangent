#!/usr/bin/env node
import { completeCommand, completionScript, renderCommandHelp, type CliCommandSpec, type CliCompletionShell } from "@tangent/core";
import { convosCommandSpec, runConvosCli } from "@convos/convos/cli";
import { dailyCommandSpec, runDailyCli } from "@tangent/daily/cli";
import { runSearchCli, searchCommandSpec } from "@tangent/search/cli";

const tangentCommandSpec: CliCommandSpec = {
  name: "tangent",
  description: "Local coding-agent conversation tools",
  subcommands: [
    convosCommandSpec,
    dailyCommandSpec,
    searchCommandSpec,
    {
      name: "completion",
      description: "Print shell completion script",
      args: "<bash|zsh|fish>",
      options: []
    },
    {
      name: "__complete",
      description: "Internal completion entrypoint",
      hidden: true
    }
  ]
};

async function main(argv = process.argv.slice(2)): Promise<void> {
  const [app, ...rest] = argv;

  if (!app || app === "--help" || app === "-h" || app === "help") {
    help();
    return;
  }

  if (app === "convos") {
    await runConvosCli(rest);
    return;
  }

  if (app === "daily") {
    const dailyArgs = isDateShortcut(rest) ? ["note", "path", ...rest] : rest;
    await runDailyCli(dailyArgs);
    return;
  }

  if (app === "search") {
    await runSearchCli(rest);
    return;
  }

  if (app === "completion") {
    const shell = shellArg(rest[0]);
    console.log(completionScript(shell, "tangent"));
    return;
  }

  if (app === "__complete") {
    for (const completion of completeCommand(tangentCommandSpec, rest)) console.log(completion);
    return;
  }

  throw new Error(`Unknown command: ${app}`);
}

function help(): void {
  console.log(renderCommandHelp(tangentCommandSpec));
  console.log(`
Examples:
  tangent convos status .
  tangent daily today
  tangent daily yesterday
  tangent daily 2026-06-07
  tangent search index
  tangent search "horizontal tension"
  tangent completion zsh
`);
}

function isDateShortcut(rest: string[]): boolean {
  const first = rest[0];
  return Boolean(first && !first.startsWith("-") && (first === "today" || first === "yesterday" || first === "tomorrow" || /^\d{4}-\d{2}-\d{2}$/.test(first) || /^[+-]\d+d$/.test(first)));
}

function shellArg(value: string | undefined): CliCompletionShell {
  if (value === "bash" || value === "zsh" || value === "fish") return value;
  throw new Error("completion requires bash, zsh, or fish.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
