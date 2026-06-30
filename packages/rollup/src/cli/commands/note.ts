import { spawn } from "node:child_process";
import { getRollupNote } from "../../sdk/index.js";
import { dateArg, stringArg, type Args } from "../args.js";
import { isRollupSelector } from "../../core/time.js";

export async function noteCommand(args: Args): Promise<void> {
  const aliasPathMode = args._[1] === "path";
  const positional = aliasPathMode ? args._[2] : args._[1];
  const selector = dateArg(args.date) || (isRollupSelector(positional) ? positional : undefined);
  const repo = stringArg(args.repo) || (selector ? aliasPathMode ? args._[3] : args._[2] : aliasPathMode ? undefined : args._[1]) || ".";
  const note = await getRollupNote({ repo, selector });
  if (args.json) {
    console.log(JSON.stringify(note, null, 2));
    return;
  }
  if (args.path || aliasPathMode) {
    console.log(note.path);
    return;
  }
  if (args.open) {
    if (!note.exists) throw new Error(`No note exists at ${note.path}`);
    openPath(note.path);
    console.log(note.path);
    return;
  }
  if (!note.exists) {
    console.log(`No note exists yet: ${note.path}`);
    return;
  }
  console.log(note.markdown);
}

function openPath(filePath: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}
