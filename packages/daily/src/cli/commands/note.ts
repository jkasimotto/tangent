import { spawn } from "node:child_process";
import { getDailyNote } from "../../sdk/index.js";
import { dateArg, stringArg, type Args } from "../args.js";

export async function noteCommand(args: Args): Promise<void> {
  const aliasPathMode = args._[1] === "path";
  const repo = aliasPathMode ? stringArg(args.repo) || "." : args._[1] || ".";
  const date = aliasPathMode ? dateArg(args.date) || args._[2] : dateArg(args.date);
  const note = await getDailyNote({ repo, date });
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
