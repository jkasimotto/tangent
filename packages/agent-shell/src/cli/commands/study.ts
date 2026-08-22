// `tangent study`: starts an interactive claude-otto session with the study
// partner contract appended to its system prompt. The session owns the
// terminal, so this spawns with stdio "inherit" directly rather than going
// through @tangent/agent-runtime's runProcess, which captures output.

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { renderCommandHelp } from "@tangent/core";
import { parseArgs } from "@tangent/core/cli";

import { STUDY_CONTRACT } from "./study-contract.js";
import { studyCommandSpec } from "../spec.js";

/** The interactive command that starts the partner session, as plain data for tests. */
export function studyLaunchCommand(contract: string): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: "claude",
    args: ["--verbose", "--dangerously-skip-permissions", "--append-system-prompt", contract],
    env: { CLAUDE_CONFIG_DIR: path.join(os.homedir(), ".claude-otto") }
  };
}

/** Dispatches `tangent study`: bare launches the partner, `contract` prints its prompt. */
export async function runStudyCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (args.help) return help();
  if (!subcommand) return launch();
  if (subcommand === "contract") {
    console.log(STUDY_CONTRACT);
    return;
  }
  throw new Error(`Unknown study command: ${subcommand}. Run "tangent study" or "tangent study contract".`);
}

/** Spawns the partner session, inheriting the terminal until it exits. */
async function launch(): Promise<void> {
  const { command, args, env } = studyLaunchCommand(STUDY_CONTRACT);
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", () => {
      console.error("claude is not on the PATH; install the Claude Code CLI first.");
      process.exitCode = 1;
      resolve();
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

/** Prints `tangent study` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(studyCommandSpec));
  console.log(`
tangent study starts an interactive agent session beside nvim: a colleague
who explores real code with Julian and gets him to change it. Scope is
decided in the opening conversation, not by an argument.

Examples:
  tangent study
  tangent study contract
`);
}
